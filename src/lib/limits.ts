export const MAX_PDF_BYTES = 25 * 1024 * 1024;

export const isPdf = (b: Buffer) => b.length > 8 && b.subarray(0, 5).toString("latin1") === "%PDF-";
