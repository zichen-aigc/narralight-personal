import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PASSWORD_SCRYPT = Object.freeze({ N: 16_384, r: 8, p: 1, keyLength: 64, maxmem: 64 * 1024 * 1024 });

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

export function validateAccountPassword(value) {
    const password = String(value || "");
    if (password.length < 6 || password.length > 256) throw fail(400, "password_invalid", "密码长度须为 6-256 个字符");
    return password;
}

export async function secretRecord(value, validator = validateAccountPassword) {
    const salt = randomBytes(16);
    const secret = validator(value);
    const hash = await scrypt(secret, salt, PASSWORD_SCRYPT.keyLength, PASSWORD_SCRYPT);
    return {
        algorithm: "scrypt-v1",
        salt: salt.toString("base64"),
        hash: Buffer.from(hash).toString("base64"),
        params: JSON.stringify({ N: PASSWORD_SCRYPT.N, r: PASSWORD_SCRYPT.r, p: PASSWORD_SCRYPT.p, keyLength: PASSWORD_SCRYPT.keyLength }),
    };
}

export async function secretMatches(value, record) {
    if (record?.algorithm !== "scrypt-v1" && record?.password_algorithm !== "scrypt-v1") return false;
    let params;
    let salt;
    let expected;
    try {
        params = JSON.parse(record.params ?? record.password_params_json);
        salt = Buffer.from(record.salt ?? record.password_salt, "base64");
        expected = Buffer.from(record.hash ?? record.password_hash, "base64");
    } catch {
        return false;
    }
    if (params?.N !== PASSWORD_SCRYPT.N || params?.r !== PASSWORD_SCRYPT.r || params?.p !== PASSWORD_SCRYPT.p || params?.keyLength !== PASSWORD_SCRYPT.keyLength) return false;
    if (salt.length !== 16 || expected.length !== PASSWORD_SCRYPT.keyLength) return false;
    const actual = Buffer.from(await scrypt(String(value || ""), salt, PASSWORD_SCRYPT.keyLength, PASSWORD_SCRYPT));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const passwordRecord = (password) => secretRecord(password, validateAccountPassword);
export const passwordMatches = (password, row) => secretMatches(password, row);

export function generateRecoveryKey() {
    return `nlrk_${randomBytes(32).toString("base64url")}`;
}

export function generateOneTimePassword() {
    return `Nlt-${randomBytes(18).toString("base64url")}`;
}
