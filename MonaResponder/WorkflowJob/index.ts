import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import { Octokit } from "@octokit/core";
import * as crypto from "crypto";

const httpTrigger: AzureFunction = async function (context: Context, req: HttpRequest): Promise<void> {
    context.log('HTTP trigger function processed a request.');

    const hmac = crypto.createHmac("sha1", process.env["GITHUB_SECRET"]);
    const signature = hmac.update(JSON.stringify(req.body)).digest('hex');
    const shaSignature = `sha1=${signature}`;
    context.log(`calculated signature: ${shaSignature}`);
    
    const gitHubSignature = req.headers['x-hub-signature'];
    context.log(`signature header: ${gitHubSignature}`);

    if (shaSignature.localeCompare(gitHubSignature)) {
        context.log("Signatures do not match!");
        context.res = {
            status: 401,
            body: "Signatures don't match"
        };
    } else {
        context.log("Signatures match - proceeding!");
        const action = req.body?.action;
        
        let msg = "This HTTP triggered function executed successfully. Expected 'workflow_job' payload.";
        if (action) {
            msg = `Acknowledge receipt of ${action} event.`
            context.log(msg);
        } else {
            context.res = {
                status: 400,
                body: "Expected 'workflow_job' payload"
            };
            return;
        }
        
        const org = req.body?.organization?.login;
        const repo = req.body?.repository?.name;
        const actor = req.body?.sender?.login;
        const labels = req.body?.workflow_job?.labels;

        // log info
        context.log(`Action: ${action}, org: ${org}, repo: ${repo}, sender: ${actor}, labels: ${labels}`);
        context.log(`GHES: ${process.env["GITHUB_SERVER"]}`);
        
        if (action !== "in_progress") {
            console.log(`Executing action ${action}`);
            const dispatch = await triggerAction(context, org, repo, action, actor, labels);
            context.res = {
                status: dispatch.status,
                body: dispatch.data
            };
        } else {
            console.log("Nothing to do for 'in_progress' event");
            context.res = {
                body: "Nothing to do for 'in_progress' event"
            };
        }
    }
};

async function triggerAction(context: Context, org: string, repo: string, action: string, actor: string, labels: string[]) {
    const baseUrl = process.env["GITHUB_SERVER"] ? `${process.env["GITHUB_SERVER"]}/api/v3` : null;
    context.log(`Attempting auth to GHES ${process.env["GITHUB_SERVER"]}`);
    const octokit = new Octokit({ 
        auth: process.env["PAT"],
        baseUrl: baseUrl
    });
    context.log("Auth successful");

    const spinner_org = process.env["EPHEMERAL_SPINNER_ORG"];
    const spinner_repo = process.env["EPHEMERAL_SPINNER_REPO"];
    const spinner_worfklow = process.env["EPHEMERAL_SPINNER_WORKFLOW"];
    const spinner_ref = process.env["EPHEMERAL_SPINNER_WORKFLOW_REF"];
    const unique_label = labels.filter(l => l !== "self-hosted")[0];
    
    context.log(`Attempting dispatch to /repos/${spinner_org}/${spinner_repo}/actions/workflows/${spinner_worfklow}/dispatches`)
    return await octokit.request('POST /repos/{org}/{repo}/actions/workflows/{workflow_name}/dispatches', {
        baseUrl: baseUrl,
        org: spinner_org,
        repo: spinner_repo,
        workflow_name: spinner_worfklow,
        ref: spinner_ref,
        inputs: {
            action: action,
            org: org,
            repo: repo,
            actor: actor,
            identifier: `${unique_label}`
        }
    });
}

export default httpTrigger;