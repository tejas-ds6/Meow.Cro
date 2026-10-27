export const maxPhotoBytes = 5 * 1024 * 1024;

const photoTypes = {
  "image/jpeg": { extension: "jpg", matches: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  "image/png": { extension: "png", matches: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { extension: "webp", matches: (buffer) => buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" }
};

export function text(value, label, { required = true, max = 2000 } = {}) {
  if (typeof value !== "string") {
    if (!required && (value === undefined || value === null || value === "")) return "";
    throw new Error(`${label} is required.`);
  }
  const trimmed = value.trim();
  if (required && !trimmed) throw new Error(`${label} is required.`);
  if (trimmed.length > max) throw new Error(`${label} is too long.`);
  return trimmed;
}

export function emailAddress(value) {
  const email = text(value, "Email address", { max: 254 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

export function photoAttachment(value) {
  const dataUrl = text(value, "Reference photo", {
    required: false,
    max: Math.ceil(maxPhotoBytes / 3) * 4 + 64
  });
  if (!dataUrl) return null;

  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("Upload a valid JPG, PNG, or WebP photo.");

  const [, contentType, encoded] = match;
  const content = Buffer.from(encoded, "base64");
  if (content.length > maxPhotoBytes) throw new Error("Your photo must be 5 MB or smaller.");
  if (content.toString("base64") !== encoded || !photoTypes[contentType].matches(content)) {
    throw new Error("Upload a valid JPG, PNG, or WebP photo.");
  }

  return {
    filename: `reference-photo.${photoTypes[contentType].extension}`,
    content,
    contentType
  };
}
