import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as random from "@pulumi/random";
import * as fs from "fs";
import * as path from "path";

// Leer el archivo buildspec.yml
const buildspecPath = path.join(__dirname, "buildspec.yml"); // Ruta al archivo buildspec.yml
const buildspecContent = fs.readFileSync(buildspecPath, "utf-8");

// Single Responsibility: Separate the creation of unique suffix
class UniqueSuffix {
    public readonly result: pulumi.Output<string>;

    constructor() {
        const uniqueSuffix = new random.RandomString("uniqueSuffix", {
            length: 8,
            special: false,
            upper: false,
        });
        this.result = uniqueSuffix.result;
    }
}

// Single Responsibility: Separate the creation of KMS key and alias
class KmsKeyManager {
    public readonly keyArn: pulumi.Output<string>;
    public readonly aliasName: pulumi.Output<string>;

    constructor() {
        const kmsKey = new aws.kms.Key("myKmsKey", {
            description: "KMS key for CodePipeline",
            deletionWindowInDays: 10,
        });

        const kmsAlias = new aws.kms.Alias("myKmsAlias", {
            name: "alias/myKmsKey",
            targetKeyId: kmsKey.keyId,
        });

        this.keyArn = kmsKey.arn; // Usar el ARN de la clave KMS
        this.aliasName = kmsAlias.name;
    }
}

// Single Responsibility: Separate the creation of S3 bucket
class S3BucketManager {
    public readonly bucket: pulumi.Output<string>;
    public readonly bucketArn: pulumi.Output<string>;
    public readonly bucketRegion: pulumi.Output<string>;

    constructor(uniqueSuffix: pulumi.Output<string>) {
        const codepipelineBucket = new aws.s3.BucketV2("codepipeline_bucket", {
            bucket: pulumi.interpolate`test-bucket-${uniqueSuffix}`,
        });

        this.bucket = codepipelineBucket.bucket;
        this.bucketArn = codepipelineBucket.arn;
        this.bucketRegion = codepipelineBucket.region; // Obtener la región del bucket
    }
}

// Single Responsibility: Separate the creation of IAM role and policy
class IamRoleManager {
    public readonly roleArn: pulumi.Output<string>;

    constructor(
        bucketArn: pulumi.Output<string>,
        connectionArn: pulumi.Output<string>,
        kmsKeyArn: pulumi.Output<string>,
    ) {
        const assumeRole = aws.iam.getPolicyDocument({
            statements: [
                {
                    effect: "Allow",
                    principals: [
                        {
                            type: "Service",
                            identifiers: ["codepipeline.amazonaws.com"],
                        },
                    ],
                    actions: ["sts:AssumeRole"],
                },
            ],
        });

        const codepipelineRole = new aws.iam.Role("codepipeline_role", {
            name: "test-role",
            assumeRolePolicy: assumeRole.then((assumeRole) => assumeRole.json),
        });

        const codepipelinePolicy = aws.iam.getPolicyDocumentOutput({
            statements: [
                {
                    effect: "Allow",
                    actions: [
                        "s3:GetObject",
                        "s3:GetObjectVersion",
                        "s3:GetBucketVersioning",
                        "s3:PutObjectAcl",
                        "s3:PutObject",
                    ],
                    resources: [bucketArn, pulumi.interpolate`${bucketArn}/*`],
                },
                {
                    effect: "Allow",
                    actions: ["codestar-connections:UseConnection"],
                    resources: [connectionArn],
                },
                {
                    effect: "Allow",
                    actions: ["codebuild:BatchGetBuilds", "codebuild:StartBuild"],
                    resources: ["*"], // Permisos para todos los proyectos de CodeBuild
                },
                // Add KMS permissions for the role
                {
                    effect: "Allow",
                    actions: ["kms:GenerateDataKey", "kms:Decrypt", "kms:Encrypt", "kms:DescribeKey"],
                    resources: [kmsKeyArn], // Usar el ARN de la clave KMS
                },
            ],
        });

        new aws.iam.RolePolicy("codepipeline_policy", {
            name: "codepipeline_policy",
            role: codepipelineRole.id,
            policy: codepipelinePolicy.apply((codepipelinePolicy) => codepipelinePolicy.json),
        });

        this.roleArn = codepipelineRole.arn;
    }
}

// Single Responsibility: Separate the creation of CodeBuild IAM role
class CodeBuildRoleManager {
    public readonly roleArn: pulumi.Output<string>;

    constructor(kmsKeyArn: pulumi.Output<string>) {
        const assumeRole = aws.iam.getPolicyDocument({
            statements: [
                {
                    effect: "Allow",
                    principals: [
                        {
                            type: "Service",
                            identifiers: ["codebuild.amazonaws.com"],
                        },
                    ],
                    actions: ["sts:AssumeRole"],
                },
            ],
        });

        const codeBuildRole = new aws.iam.Role("codebuild_role", {
            name: "codebuild-service-role",
            assumeRolePolicy: assumeRole.then((assumeRole) => assumeRole.json),
        });

        const codeBuildPolicy = aws.iam.getPolicyDocumentOutput({
            statements: [
                {
                    effect: "Allow",
                    actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
                    resources: ["*"], // Permisos para CloudWatch Logs
                },
                {
                    effect: "Allow",
                    actions: ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"],
                    resources: ["*"], // Permisos para S3 (ajusta según sea necesario)
                },
                // Add KMS permissions for the role
                {
                    effect: "Allow",
                    actions: ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
                    resources: [kmsKeyArn], // Usar el ARN de la clave KMS
                },
            ],
        });

        new aws.iam.RolePolicy("codebuild_policy", {
            name: "codebuild_policy",
            role: codeBuildRole.id,
            policy: codeBuildPolicy.apply((codeBuildPolicy) => codeBuildPolicy.json),
        });

        this.roleArn = codeBuildRole.arn;
    }
}

// Single Responsibility: Separate the creation of CodeBuild project
class CodeBuildManager {
    public readonly projectName: pulumi.Output<string>;

    constructor(codeBuildRoleArn: pulumi.Output<string>) {
        const codeBuildProject = new aws.codebuild.Project("codebuild_project", {
            name: "nextjs-project",
            serviceRole: codeBuildRoleArn, // Usar el ARN del rol de CodeBuild
            artifacts: {
                type: "CODEPIPELINE", // Los artefactos se generan para CodePipeline
            },
            environment: {
                computeType: "BUILD_GENERAL1_SMALL",
                image: "aws/codebuild/amazonlinux2-x86_64-standard:5.0", // Imagen con Node.js 20
                type: "LINUX_CONTAINER",
                environmentVariables: [
                    {
                        name: "NODE_ENV",
                        value: "production",
                    },
                ],
            },
            source: {
                type: "CODEPIPELINE", // El código fuente proviene de CodePipeline
                buildspec: buildspecContent, // Usar el contenido del archivo buildspec.yml
            },
        });

        this.projectName = codeBuildProject.name;
    }
}

// Single Responsibility: Separate the creation of CodePipeline
class CodePipelineManager {
    constructor(
        roleArn: pulumi.Output<string>,
        bucket: pulumi.Output<string>,
        kmsAliasName: pulumi.Output<string>,
        connectionArn: pulumi.Output<string>,
        codeBuildProjectName: pulumi.Output<string>,
    ) {
        new aws.codepipeline.Pipeline("codepipeline", {
            name: "tf-test-pipeline",
            roleArn: roleArn,
            artifactStores: [
                {
                    location: bucket,
                    type: "S3",
                    encryptionKey: {
                        id: kmsAliasName,
                        type: "KMS",
                    },
                },
            ],
            stages: [
                {
                    name: "Source",
                    actions: [
                        {
                            name: "Source",
                            category: "Source",
                            owner: "AWS",
                            provider: "CodeStarSourceConnection",
                            version: "1",
                            outputArtifacts: ["source_output"],
                            configuration: {
                                ConnectionArn: connectionArn,
                                FullRepositoryId: "jesussalatiel/react-project",
                                BranchName: "master",
                            },
                        },
                    ],
                },
                {
                    name: "Build",
                    actions: [
                        {
                            name: "Build",
                            category: "Build",
                            owner: "AWS",
                            provider: "CodeBuild",
                            inputArtifacts: ["source_output"],
                            outputArtifacts: ["build_output"],
                            version: "1",
                            configuration: {
                                ProjectName: codeBuildProjectName, // Usar el nombre del proyecto de CodeBuild
                            },
                        },
                    ],
                },
                {
                    name: "Deploy",
                    actions: [
                        {
                            name: "Deploy",
                            category: "Deploy",
                            owner: "AWS",
                            provider: "S3",
                            inputArtifacts: ["build_output"],
                            version: "1",
                            configuration: {
                                BucketName: bucket, // Nombre del bucket S3
                                Extract: "true", // Extraer los archivos del artefacto
                            },
                        },
                    ],
                },
            ],
        });
    }
}

// Crear un User Pool de Amazon Cognito
const userPool = new aws.cognito.UserPool("myUserPool", {
    name: "my-user-pool",
    autoVerifiedAttributes: ["email"], // Verificar automáticamente el correo electrónico
    passwordPolicy: {
        minimumLength: 8,
        requireLowercase: true,
        requireNumbers: true,
        requireSymbols: true,
        requireUppercase: true,
    },
    schemas: [
        // Usar "schemas" en lugar de "schema"
        {
            attributeDataType: "String",
            name: "email",
            required: true,
        },
    ],
});

// Crear un User Pool Client
const userPoolClient = new aws.cognito.UserPoolClient("myUserPoolClient", {
    name: "my-user-pool-client",
    userPoolId: userPool.id, // Asociar el Client al User Pool
    generateSecret: false, // No generar un secreto (útil para aplicaciones web)
    explicitAuthFlows: ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
});

// Declare at top level
let websiteUrl: pulumi.Output<string>;

// Main function to orchestrate the creation of resources
function main() {
    const uniqueSuffix = new UniqueSuffix();
    const kmsKeyManager = new KmsKeyManager();
    const s3BucketManager = new S3BucketManager(uniqueSuffix.result);
    const connection = new aws.codestarconnections.Connection("example", {
        name: "example-connection",
        providerType: "GitHub",
    });
    const iamRoleManager = new IamRoleManager(
        s3BucketManager.bucketArn,
        connection.arn,
        kmsKeyManager.keyArn, // Pasar el ARN de la clave KMS
    );
    const codeBuildRoleManager = new CodeBuildRoleManager(kmsKeyManager.keyArn); // Crear el rol de IAM para CodeBuild
    const codeBuildManager = new CodeBuildManager(codeBuildRoleManager.roleArn); // Crear el proyecto de CodeBuild
    const codePipelineManager = new CodePipelineManager(
        iamRoleManager.roleArn,
        s3BucketManager.bucket,
        kmsKeyManager.aliasName,
        connection.arn,
        codeBuildManager.projectName, // Pasar el nombre del proyecto de CodeBuild
    );

    // Configuración de Block Public Access para el bucket S3
    const bucketPublicAccessBlock = new aws.s3.BucketPublicAccessBlock("bucket_public_access_block", {
        bucket: s3BucketManager.bucket,
        blockPublicAcls: false, // Permitir ACLs públicas
        blockPublicPolicy: false, // Permitir políticas de bucket públicas
        ignorePublicAcls: false, // No ignorar ACLs públicas
        restrictPublicBuckets: false, // No restringir el acceso público al bucket
    });

    // Habilitar el hosting estático en el bucket S3
    const bucketWebsite = new aws.s3.BucketWebsiteConfigurationV2("bucket_website", {
        bucket: s3BucketManager.bucket,
        indexDocument: {
            suffix: "index.html",
        },
        errorDocument: {
            key: "error.html",
        },
    });

    // Return the URL instead of exporting it
    return pulumi.interpolate`http://${s3BucketManager.bucket}.s3-website-${s3BucketManager.bucketRegion}.amazonaws.com`;
}

// Set the URL and export it at top level
websiteUrl = main();
export { websiteUrl };

// Exportar el User Pool ID y el User Pool Client ID
export const userPoolId = userPool.id;
export const userPoolClientId = userPoolClient.id;
