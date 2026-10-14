export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 1024;

export function isValidPassword(value) {
  return typeof value === "string"
    && value.length >= PASSWORD_MIN_LENGTH
    && value.length <= PASSWORD_MAX_LENGTH;
}
