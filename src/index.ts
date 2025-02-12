import * as core from '@actions/core';
import * as github from '@actions/github';

async function getChangedFiles() {
    try {
        const token = core.getInput('github-token', { required: true });
        const octokit = github.getOctokit(token);
        const context = github.context;

        // Get the SHA of the commit
        const { sha } = context;
        const baseSha = context.payload.before;

        // Get list of changed files using compare API
        const { data: diffData } = await octokit.rest.repos.compareCommits({
            owner: context.repo.owner,
            repo: context.repo.repo,
            base: baseSha,
            head: sha,
        });

        // Extract file paths
        const changedFiles = diffData.files || [];
        const filePaths = changedFiles.map(file => file.filename);

        // Batch files in groups of 10 to avoid rate limits
        const batchSize = 10;
        const batches = [];

        for (let i = 0; i < filePaths.length; i += batchSize) {
            const batch = filePaths.slice(i, i + batchSize);
            batches.push(batch);
        }

        const allFiles = new Map<string, string>();

        // Process batches sequentially, but files within batch in parallel
        for (const batch of batches) {
            const filePromises = batch.map(async (path) => {
                try {
                    const { data: fileContent } = await octokit.rest.repos.getContent({
                        owner: context.repo.owner,
                        repo: context.repo.repo,
                        path,
                        ref: sha
                    });

                    if ('content' in fileContent) {
                        const content = Buffer.from(fileContent.content, 'base64').toString();
                        return { path, content };
                    }
                    return { path, content: '' };
                } catch (error) {
                    core.warning(`Failed to get content for ${path}: ${error}`);
                    return { path, content: '' };
                }
            });

            const batchResults = await Promise.all(filePromises);

            // Add results to map
            batchResults.forEach(({ path, content }) => {
                allFiles.set(path, content);
            });

            // Add a small delay between batches to be safe with rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        return allFiles;
    } catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        }
        return new Map();
    }
}

async function run() {
    const changedFiles = await getChangedFiles();

    const projectId = core.getInput("project_id", { required: true });
    const apiKey = core.getInput("api_key", { required: true });

    const response = await fetch("https://smee.io/fFmI0AYEiUYxEoR7", {
        method: "POST",
        body: JSON.stringify({
            projectId: projectId,
            apiKey: apiKey,
            changedFiles: changedFiles
        })
    })

    if (!response.ok) core.setFailed("Something went wrong.")

    for (const [path, content] of changedFiles) {
        // Do something with path and content
        core.debug(`Processing file: ${path}/n${content}`);
    }
}

run();