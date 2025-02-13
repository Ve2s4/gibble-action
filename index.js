#!/usr/bin/env node
import { intro, text, outro, spinner, password, select, log } from '@clack/prompts';
import pc from 'picocolors';
import open from 'open';
import * as child_process from "node:child_process";
import * as fs from "node:fs";
import { createServer } from "http";

/**
 * Starts a local server to handle authentication callback
 * @returns {Promise<string>} Authentication token
 */
async function startAuthServer() {
    return new Promise((resolve, reject) => {
        const server = createServer((req, res) => {
            try {
                const url = new URL(req.url, "http://localhost:8008");
                const token = url.searchParams.get("token");

                if (token) {
                    res.writeHead(200, {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"  // Add CORS header
                    });
                    // Send response body and end the response
                    res.end(JSON.stringify({ success: true, message: "Token received" }));
                    // Close server after small delay to ensure response is sent
                    setTimeout(() => {
                        server.close();
                    }, 100);
                    resolve(token);
                } else {
                    res.writeHead(400, {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    });
                    res.end(JSON.stringify({ success: false, message: "No token received" }));
                    reject(new Error("No token received"));
                }
            } catch (error) {
                console.error("Server error:", error);
                res.writeHead(500, {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*"
                });
                res.end(JSON.stringify({ success: false, message: "Server error" }));
                reject(error);
            }
        });

        server.listen(8008, () => {
            console.log(pc.green("🖥️  Waiting for authentication (don't worry, we're not going anywhere)..."));
        });

        // Handle server errors
        server.on('error', (error) => {
            console.error("Server failed to start:", error);
            reject(error);
        });
    });
}

/**
 * Cleans MDX content by removing markdown, JSX, and other formatting
 * @param {string} rawContent - Raw MDX content
 * @returns {string} Cleaned content
 */
function cleanContent(rawContent) {
    try {
        return rawContent
            .replace(/<\/?[^>]+>/g, "")
            .replace(/export\s+const\s+\w+\s+=.*?\n/g, "")
            .replace(/import\s+.*?\n/g, "")
            .replace(/#{1,6}\s+/g, "")
            .replace(/!?\[([^\]]+)\]\([^)]*\)/g, (_, text) => text)
            .replace(/(\*\*|__)(.*?)\1/g, "$2")
            .replace(/(\*|_)(.*?)\1/g, "$2")
            .replace(/```[\s\S]*?```/g, "")
            .replace(/`[^`]*`/g, "")
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/---+/g, "")
            .replace(/\s+/g, " ")
            .trim();
    } catch (error) {
        console.error("Error cleaning content:", error);
        throw new Error("Failed to clean content");
    }
}

/**
 * Gets all MDX files in the repository
 * @returns {string[]} Array of MDX file paths
 */
function getAllMdxFiles() {
    try {
        const output = child_process.execSync('git ls-files *.mdx', { encoding: 'utf-8' });
        return output.trim().split('\n').filter(Boolean);
    } catch (error) {
        console.error("Failed to get MDX files:", error);
        throw new Error("Cannot list repository files");
    }
}

/**
 * Gets changed MDX files since last push
 * @returns {string[]} Array of changed MDX file paths
 */
function getChangedMdxFiles() {
    try {
        const output = child_process.execSync('git diff --name-only @{push}', { encoding: 'utf-8' });
        return output.trim().split('\n').filter(file => file.endsWith('.mdx'));
    } catch (error) {
        console.error("Failed to get changed files:", error);
        throw new Error("Cannot detect changed files");
    }
}

/**
 * Process files and send to API
 * @param {Array<{path: string, content: string}>} files - Files to process
 * @param {string} apiKey - API key
 * @param {string} projectId - Project ID
 * @param authToken
 * @returns {Promise<void>}
 */
async function processFiles(files, apiKey, projectId, authToken) {
    try {
        const response = await fetch("http://localhost:3000/api/integration/process-docs", {
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                apiKey,
                projectId,
                token: authToken,
                files
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const payload = await response.json();

        if (payload.success) {
            outro("🎉 Your documents have been processed successfully! Time to celebrate! 🎊");

        } else {
            throw new Error(payload.message);
        }
    } catch (error) {
        log.error(`💥 Oops! Something went wrong: ${error.message}`);
        throw error;
    }
}

async function main() {
    try {
        // Start with a bang! 🎉
        intro('Welcome to Gibble CLI - Where MDX meets AI magic! ✨');

        const authPromise = startAuthServer()

        // Start authentication process first and wait for it to complete
        console.log(pc.green('\n🌟 Time to authenticate! Opening your browser...'));

        const deviceLoginUrl = 'http://localhost:3000/api/auth/cli-auth';
        console.log(pc.blue(deviceLoginUrl));

        try {
            await open(deviceLoginUrl);
        } catch (err) {
            console.log(pc.yellow('\n😅 Couldn\'t open your browser automatically. No worries! Just copy-paste the URL above.'));
        }

        // Wait for authentication with a fun spinner
        const s = spinner();
        const authToken = await authPromise;
        s.start("Waiting for authentication...");
        while (!authToken) {
            s.start("Waiting for authentication...");
        }
        s.stop(`Authentication successful! ${authToken}`)

        // Only proceed with prompts after authentication is complete
        // Get project details
        const projectId = await text({
            message: "🏷️  What's your voice agent's project ID?"
        });

        if (!projectId) {
            throw new Error("Project ID is required");
        }

        const apiKey = await password({
            message: "🔑 What's your super secret API Key?"
        });

        if (!apiKey) {
            throw new Error("API Key is required");
        }

        const fullScan = await select({
            message: "📚 How much should we scan?",
            initialValue: "No",
            options: [
                { value: "Yes", label: "Full Sync (Let's scan ALL the things! 🎆)" },
                { value: "No", label: "Partial Sync (Just the recent changes 🎯)" }
            ],
        });

        // Get and process files based on scan type
        const mdxFiles = fullScan === "Yes" ? getAllMdxFiles() : getChangedMdxFiles();

        if (mdxFiles.length === 0) {
            console.log(pc.green('✨ Nothing to process! Your work here is done!'));
            return;
        }

        console.log(pc.cyan('\n📂 Found these interesting files:'));
        mdxFiles.forEach(file => console.log(pc.gray(`   📄 ${file}`)));

        const s2 = spinner();
        s2.start("🎭 Processing your files (making them look pretty)...");

        const fileContents = mdxFiles.map((file) => {
            try {
                return { path: file, content: cleanContent(fs.readFileSync(file, 'utf-8')) };
            } catch (err) {
                console.error(pc.red(`❌ Couldn't read ${file}: ${err.message}`));
                return null;
            }
        }).filter(Boolean);

        s2.stop();

        await processFiles(fileContents, apiKey, projectId, authToken);

    } catch (error) {
        log.error(`\n💥 Well, this is embarrassing... ${error.message}`);
        process.exit(1);
    }
}

main().catch(error => {
    console.error(pc.red(`\n🔥 Fatal error: ${error.message}`));
    process.exit(1);
}).finally(()=>process.exit(1));