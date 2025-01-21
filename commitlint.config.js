export default {
    extends: ["@commitlint/config-conventional"],
    rules: {
        // Ensure the subject line does not exceed 72 characters
        "header-max-length": [2, "always", 72],
        // Enforce kebab-case for scopes
        "scope-case": [2, "always", "kebab-case"],
        // Enforce a set of allowed commit types (feat, fix, etc.)
        "type-enum": [
            2,
            "always",
            [
                "feat", // New feature
                "fix", // Bug fix
                "docs", // Documentation changes
                "style", // Formatting, missing semicolons, etc.
                "refactor", // Code refactoring
                "perf", // Performance improvements
                "test", // Tests
                "chore", // Routine tasks (build, dependencies, etc.)
                "ci", // Continuous integration
                "release", // Version release
            ],
        ],
        // Prevent WIP (Work in Progress) in commit messages
        "no-wip": [2, "never"],
    },
};
