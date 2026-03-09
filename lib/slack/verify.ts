import { createHmac, timingSafeEqual } from "node:crypto";

const SLACK_SIGNATURE_VERSION = "v0";
const MAX_TIMESTAMP_DRIFT_SECONDS = 5 * 60;

export class SlackSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlackSignatureError";
  }
}

export function verifySlackSignature(
  rawBody: string,
  headers: Headers,
): void {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    throw new SlackSignatureError("SLACK_SIGNING_SECRET is not configured.");
  }

  const timestamp = headers.get("x-slack-request-timestamp");
  const slackSignature = headers.get("x-slack-signature");

  if (!timestamp || !slackSignature) {
    throw new SlackSignatureError("Missing Slack signature headers.");
  }

  const timestampNum = Number(timestamp);
  if (Number.isNaN(timestampNum)) {
    throw new SlackSignatureError("Invalid timestamp header.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampNum) > MAX_TIMESTAMP_DRIFT_SECONDS) {
    throw new SlackSignatureError("Request timestamp is too old.");
  }

  const basestring = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${rawBody}`;
  const computedSignature =
    `${SLACK_SIGNATURE_VERSION}=` +
    createHmac("sha256", signingSecret).update(basestring).digest("hex");

  const a = Buffer.from(computedSignature, "utf-8");
  const b = Buffer.from(slackSignature, "utf-8");

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new SlackSignatureError("Invalid Slack signature.");
  }
}
