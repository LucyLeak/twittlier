const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const ACCESS_COOKIE_NAME = "tw_private_access";
export const ACCESS_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 30;

type AccessCookiePayload = {
  exp: number;
};

function encodeBase64(binary: string) {
  if (typeof btoa === "function") {
    return btoa(binary);
  }
  return Buffer.from(binary, "binary").toString("base64");
}

function decodeBase64(base64Value: string) {
  if (typeof atob === "function") {
    return atob(base64Value);
  }
  return Buffer.from(base64Value, "base64").toString("binary");
}

function toBase64Url(input: Uint8Array) {
  let binary = "";
  for (let index = 0; index < input.length; index += 1) {
    binary += String.fromCharCode(input[index]);
  }
  return encodeBase64(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (base64.length % 4 || 4)) % 4;
  const padded = `${base64}${"=".repeat(padLength)}`;
  const decodedBinary = decodeBase64(padded);
  const output = new Uint8Array(decodedBinary.length);
  for (let index = 0; index < decodedBinary.length; index += 1) {
    output[index] = decodedBinary.charCodeAt(index);
  }
  return output;
}

async function hmacSha256(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload));
  return toBase64Url(new Uint8Array(signatureBuffer));
}

function constantTimeEquals(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function parsePayload(rawPayload: string): AccessCookiePayload | null {
  try {
    const payload = JSON.parse(rawPayload) as AccessCookiePayload;
    if (!payload || typeof payload.exp !== "number") return null;
    return payload;
  } catch {
    return null;
  }
}

export function getAccessSecret() {
  return process.env.ACCESS_COOKIE_SECRET ?? process.env.SITE_ACCESS_CODE ?? "";
}

export async function createAccessCookieValue(
  secret: string,
  ttlSeconds = ACCESS_COOKIE_TTL_SECONDS
) {
  const payload: AccessCookiePayload = {
    exp: Date.now() + ttlSeconds * 1000
  };
  const encodedPayload = toBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const signature = await hmacSha256(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function isAccessCookieValid(rawCookieValue: string | undefined, secret: string) {
  if (!rawCookieValue || !secret) return false;

  const parts = rawCookieValue.split(".");
  if (parts.length !== 2) return false;

  const [encodedPayload, suppliedSignature] = parts;
  const expectedSignature = await hmacSha256(secret, encodedPayload);
  if (!constantTimeEquals(suppliedSignature, expectedSignature)) {
    return false;
  }

  const payloadBytes = fromBase64Url(encodedPayload);
  const parsedPayload = parsePayload(textDecoder.decode(payloadBytes));
  if (!parsedPayload) return false;

  return parsedPayload.exp > Date.now();
}

export function getCookieValueFromHeader(cookieHeader: string | null, cookieName: string) {
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === cookieName) {
      return rawValue.join("=");
    }
  }
  return undefined;
}
