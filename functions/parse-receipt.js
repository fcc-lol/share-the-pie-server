import Anthropic from "@anthropic-ai/sdk";

// JSON schema for structured output — mirrors the fields the rest of the app
// consumes from a parsed receipt (same shape Veryfi returns). Line item `id`s
// are assigned in code after parsing, so they aren't requested here.
const RECEIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    vendor: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        type: { type: "string" },
        address: { type: "string" }
      },
      required: ["name", "type", "address"]
    },
    line_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          description: { type: "string" },
          quantity: { type: "number" },
          total: { type: "number" }
        },
        required: ["description", "quantity", "total"]
      }
    },
    subtotal: { type: "number" },
    tax: { type: "number" },
    tip: { type: "number" },
    total: { type: "number" }
  },
  required: ["vendor", "line_items", "subtotal", "tax", "tip", "total"]
};

export async function parseWithClaude(image) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // The client sends a data URL (e.g. "data:image/png;base64,...."); the
  // Anthropic image block needs the media type and the bare base64 separately.
  const dataUrlMatch = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(
    image || ""
  );
  const mediaType = dataUrlMatch ? dataUrlMatch[1] : "image/png";
  const base64Data = dataUrlMatch ? dataUrlMatch[2] : image;

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      output_config: { format: { type: "json_schema", schema: RECEIPT_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Data
              }
            },
            {
              type: "text",
              text: "Extract this receipt into the required JSON structure. Include the merchant's name, type, and address; every purchased line item with its description, quantity, and total price (exclude items with zero, missing, or blank price); and the subtotal, tax, tip, and grand total shown on the receipt, where subtotal + tax + tip equals the grand total."
            }
          ]
        }
      ]
    });

    if (response.stop_reason === "refusal") {
      console.error("Claude declined to parse receipt:", response.stop_details);
      return undefined;
    }

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock) return undefined;

    const parsed = JSON.parse(textBlock.text);
    parsed.line_items = (parsed.line_items || []).map((item, index) => ({
      ...item,
      id: index
    }));

    return parsed;
  } catch (error) {
    console.error("Error:", error);
    return undefined;
  }
}

export async function parseWithVeryfi(image) {
  try {
    const response = await fetch(
      "https://api.veryfi.com/api/v8/partner/documents",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "CLIENT-ID": process.env.VERYFI_CLIENT_ID,
          AUTHORIZATION: `apikey ${process.env.VERYFI_API_KEY}`,
        },
        body: JSON.stringify({
          file_data: image,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error:", error);
  }
}
