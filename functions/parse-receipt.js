export async function parseWithGPT(image) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  try {
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant designed to output JSON.",
        },
        { role: "user", content: {
          "type": "image_url", 
          "image_url": 
            {
              "url": image
            }
          }
        },
        { role: "user", content:
          `{
              "transaction": {
                "datetime": "DATE_TIME",
                "merchant": "MERCHANT_NAME",
              },
              "items": [
                {
                  "name": "ITEM_NAME",
                  "price": 0.00
                },
                {
                  "name": "ITEM_NAME",
                  "price": 0.00
                },
                {
                  "name": "ITEM_NAME",
                  "price": 0.00
                }
              ],
              "total": {
                "subtotal": 0.00,
                "tax": 0.00,
                "tip": 0.00,
                "total": 0.00
              }
            }` },
        { role: "user", content: "when did this transaction occur? what was the merchant's name? create a list of the items, excluding items that have zero price or no price or blank price, and show the grand total amount and tax and tip that is shown on this receipt, where the subtotal, tax, and tip needs to add up to the grand total" }
      ],
      model: "gpt-3.5-turbo-1106",
      response_format: { type: "json_object" }
    })

    return completion.choices[0].message.content
  } catch (error) {
    console.error('Error:', error)
  }
}

export async function parseWithVeryfi(image) {
  try {
    const response = await fetch('https://api.veryfi.com/api/v8/partner/documents', {
      'method': 'POST',
      'headers': {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'CLIENT-ID': process.env.VERYFI_CLIENT_ID,
        'AUTHORIZATION': `apikey ${process.env.VERYFI_API_KEY}`
      },
      body: JSON.stringify({
        "file_data": image
      })
    })

    if (!response.ok) {
      throw new Error(`Error: ${response.status}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Error:', error)
  }
}