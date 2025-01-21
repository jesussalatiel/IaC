import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// Create an AWS resource (S3 Bucket) named "testing-jesus".
const bucket = new aws.s3.BucketV2("testing-jesus");

// Configure the bucket to act as a static website.
// Defines "index.html" as the start document for the website.
const website = new aws.s3.BucketWebsiteConfigurationV2("website", {
    bucket: bucket.id, // Associate the configuration with the created bucket.
    indexDocument: {
        suffix: "index.html", // Specify the start document for the website.
    },
});

// Set ownership controls on the S3 bucket.
// Defines that uploaded objects should be owned by the object writer (ObjectWriter).
const ownershipControls = new aws.s3.BucketOwnershipControls("ownership-controls", {
    bucket: bucket.id, // Apply the rule to the created bucket.
    rule: {
        objectOwnership: "ObjectWriter", // Configure object ownership.
    },
});

// Configure public access settings for the bucket.
// In this case, it allows public ACLs by disabling the public ACL block.
const publicAccessBlock = new aws.s3.BucketPublicAccessBlock("public-access-block", {
    bucket: bucket.id, // Apply the setting to the created bucket.
    blockPublicAcls: false, // Allow public ACLs.
});

// Upload the "index.html" file to the S3 bucket as an object.
// Defines the content type as HTML and sets it as "public-read" for public access.
new aws.s3.BucketObject(
    "index.html",
    {
        bucket: bucket.id, // Specifies the destination bucket.
        source: new pulumi.asset.FileAsset("./index.html"), // Local file path to upload.
        contentType: "text/html", // Content type of the file.
        acl: "public-read", // Allows public access to the file.
    },
    {
        dependsOn: [publicAccessBlock, ownershipControls, website], // Ensures the previous configurations are complete before uploading the file.
    },
);

// Export the bucket name and the website URL for external use.
export const bucketName = bucket.id; // The bucket's name.
export const bucketEndpoint = pulumi.interpolate`http://${website.websiteEndpoint}`; // The URL of the generated website.
