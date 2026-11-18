import { randomBytes } from "crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 7;

export function generateCode(): string {
    const bytes = randomBytes(CODE_LENGTH);
    let code = "";
    for (const byte of bytes) {
        code += ALPHABET[byte % ALPHABET.length];
    }
    return code;
}