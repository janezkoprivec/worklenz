import {Validator} from "jsonschema";
import {QueryResult} from "pg";
import {log_error, isValidateEmail} from "./utils";
import emailRequestSchema from "../json_schemas/email-request-schema";
import db from "../config/db";

// Email transport: Resend (https://resend.com).
// Configure with:
//   RESEND_API_KEY  required
//   MAIL_FROM       required, e.g. "Worklenz <noreply@your-domain.com>"
//                   (must be a verified sender / domain in Resend)
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface IEmail {
  to?: string[];
  subject: string;
  html: string;
}

export class EmailRequest implements IEmail {
  public readonly html: string;
  public readonly subject: string;
  public readonly to: string[];

  constructor(toEmails: string[], subject: string, content: string) {
    this.to = toEmails;
    this.subject = subject;
    this.html = content;
  }
}

function isValidMailBody(body: IEmail) {
  const validator = new Validator();
  return validator.validate(body, emailRequestSchema).valid;
}

async function removeMails(query: string, emails: string[]) {
  const result: QueryResult<{ email: string; }> = await db.query(query, []);
  const bouncedEmails = result.rows.map(e => e.email);
  for (let i = emails.length - 1; i >= 0; i--) {
    const email = emails[i];
    if (bouncedEmails.includes(email)) {
      emails.splice(i, 1);
    }
  }
}

async function filterSpamEmails(emails: string[]): Promise<void> {
  await removeMails("SELECT email FROM spam_emails ORDER BY email;", emails);
}

async function filterBouncedEmails(emails: string[]): Promise<void> {
  await removeMails("SELECT email FROM bounced_emails ORDER BY email;", emails);
}

export async function sendEmail(email: IEmail): Promise<string | null> {
  try {
    if (!RESEND_API_KEY || !MAIL_FROM) {
      log_error(new Error("Email skipped: RESEND_API_KEY and MAIL_FROM must be set."));
      return null;
    }

    const options = {...email} as IEmail;
    options.to = Array.isArray(options.to) ? Array.from(new Set(options.to)) : [];

    options.to = options.to
      .filter(e => e && typeof e === "string" && e.trim().length > 0)
      .map(e => e.trim())
      .filter(e => isValidateEmail(e));

    if (options.to.length) {
      await filterBouncedEmails(options.to);
      await filterSpamEmails(options.to);
    }

    if (!options.to.length) return null;
    if (!isValidMailBody(options)) return null;

    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: options.to,
        subject: options.subject,
        html: options.html
      })
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      log_error(new Error(`Resend send failed: ${res.status} ${res.statusText} ${errBody}`));
      return null;
    }

    const data = await res.json().catch(() => null) as { id?: string } | null;
    return data?.id || null;
  } catch (e) {
    log_error(e);
  }

  return null;
}
