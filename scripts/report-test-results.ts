/**
 * Parse JUnit XML and emit Azure Pipelines logging commands.
 *
 * ##vso[task.logissue type=error]  → shows as error annotation on GitHub PR checks
 * ##vso[task.logissue type=warning] → shows as warning annotation
 * ##vso[task.complete result=SucceededWithIssues] → marks step yellow on warnings
 *
 * Usage: tsx scripts/report-test-results.ts <junit-file> [<junit-file> ...]
 */
import { readFileSync, existsSync } from "fs";

const files = process.argv.slice(2).filter(Boolean);
if (files.length === 0) {
    console.log("Usage: tsx scripts/report-test-results.ts <junit-xml-file> ...");
    process.exit(0);
}

let totalTests = 0;
let totalFailed = 0;
let totalErrors = 0;

for (const file of files) {
    if (!existsSync(file)) {
        console.log(`##vso[task.logissue type=warning]JUnit file not found: ${file}`);
        continue;
    }

    const xml = readFileSync(file, "utf-8");

    // Parse <testsuite> attributes
    const suiteRegex = /<testsuite\s[^>]*>/g;
    let suiteMatch;
    while ((suiteMatch = suiteRegex.exec(xml)) !== null) {
        const attrs = suiteMatch[0];
        totalTests += num(attrs, "tests");
        totalFailed += num(attrs, "failures");
        totalErrors += num(attrs, "errors");
    }

    // Parse failed <testcase> elements and emit error lines
    const caseRegex = /<testcase\s([^>]*?)>([\s\S]*?)<\/testcase>/g;
    let caseMatch;
    while ((caseMatch = caseRegex.exec(xml)) !== null) {
        const cAttrs = caseMatch[1];
        const cBody = caseMatch[2];

        const failMatch = cBody.match(/<failure[^>]*?(?:message="([^"]*)")?[^>]*>([\s\S]*?)<\/failure>/);
        const errMatch = cBody.match(/<error[^>]*?(?:message="([^"]*)")?[^>]*>([\s\S]*?)<\/error>/);

        if (failMatch || errMatch) {
            const name = attr(cAttrs, "name");
            const msgAttr = failMatch?.[1] ?? errMatch?.[1] ?? "";
            const bodyText = (failMatch?.[2] ?? errMatch?.[2] ?? "").trim();
            // Prefer body text (has full error + expected/received), fall back to message attr
            const raw = bodyText || msgAttr || "Test failed";
            // Decode XML entities, strip stack traces, collapse whitespace
            const decoded = raw
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&amp;/g, "&")
                .replace(/&quot;/g, '"')
                .replace(/&#10;/g, " ")
                .replace(/&#13;/g, "")
                .replace(/\s+at\s+.*/g, "") // strip stack trace lines
                .replace(/\r?\n/g, " ")
                .replace(/;/g, ",")
                .replace(/\s{2,}/g, " ")
                .trim()
                .slice(0, 800);
            console.log(`##vso[task.logissue type=error]${name}: ${decoded}`);
        }
    }
}

const passed = totalTests - totalFailed - totalErrors;
const failed = totalFailed + totalErrors;

// Summary line
console.log(`\nTest Results: ${passed} passed, ${failed} failed, ${totalTests} total`);

if (failed > 0) {
    console.log(`##vso[task.complete result=Failed]${failed} test(s) failed`);
}

function attr(str: string, name: string): string {
    const m = str.match(new RegExp(`${name}="([^"]*)"`));
    return m ? m[1] : "";
}

function num(str: string, name: string): number {
    return Number(attr(str, name)) || 0;
}
