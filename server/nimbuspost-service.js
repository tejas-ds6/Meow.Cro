const apiBaseUrl = "https://api-v2.nimbuspost.com";

export class NimbusPostError extends Error {
  constructor(message) {
    super(message);
    this.name = "NimbusPostError";
  }
}

export function createNimbusPostService(environment, fetchImplementation = globalThis.fetch) {
  const apiKey = String(environment.NIMBUSPOST_API_KEY || "").trim();
  const apiSecret = String(environment.NIMBUSPOST_API_SECRET || "").trim();
  const warehouseId = String(environment.NIMBUSPOST_WAREHOUSE_ID || "").trim();

  async function request(endpoint, { method = "GET", body } = {}) {
    let response;
    try {
      response = await fetchImplementation(new URL(endpoint, apiBaseUrl), {
        method,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          "x-api-key": apiKey,
          "x-api-secret": apiSecret
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000)
      });
    } catch (error) {
      throw new NimbusPostError(`NimbusPost could not be reached: ${error.message}`);
    }

    const result = await response.json().catch(() => null);
    if (!response.ok || result?.success !== true) {
      const detail = result?.error?.detail || result?.message || `HTTP ${response.status}`;
      throw new NimbusPostError(`NimbusPost request failed: ${detail}`);
    }
    if (!result.data || typeof result.data !== "object") {
      throw new NimbusPostError("NimbusPost returned an invalid response.");
    }
    return result.data;
  }

  function requireConfigured() {
    if (!configured) {
      throw new NimbusPostError("NimbusPost is not configured. Set NIMBUSPOST_API_KEY, NIMBUSPOST_API_SECRET, and NIMBUSPOST_WAREHOUSE_ID on the server.");
    }
  }

  const configured = Boolean(apiKey && apiSecret && warehouseId);

  function shipmentFrom(data) {
    const shipment = data.shipment || data;
    if (typeof shipment.awb !== "string" || !shipment.awb.trim()) return null;
    const secureUrl = (value) => {
      if (typeof value !== "string" || !value.trim()) return "";
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        throw new NimbusPostError("NimbusPost returned an invalid shipment link.");
      }
      if (parsed.protocol !== "https:" || !parsed.hostname) {
        throw new NimbusPostError("NimbusPost returned a shipment link that is not HTTPS.");
      }
      return parsed.href;
    };
    return {
      awb: shipment.awb.trim(),
      courierName: typeof shipment.courier_name === "string" ? shipment.courier_name.trim() : "",
      trackingUrl: secureUrl(shipment.tracking_url),
      labelUrl: secureUrl(shipment.label_url),
      status: typeof shipment.order_status === "string" ? shipment.order_status.trim() : "booked"
    };
  }

  async function createOrder(order, { state, packageDetails }) {
    requireConfigured();
    const phone = order.phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (!/^\d{10}$/.test(phone)) {
      throw new NimbusPostError("NimbusPost requires a 10-digit Indian customer phone number.");
    }
    const data = await request("/v2/orders", {
      method: "POST",
      body: {
        order_number: `MEOWCRO-${order.number}`,
        order_type: "b2c",
        payment_mode: "prepaid",
        warehouse_id: warehouseId,
        shipping_address: {
          name: order.name,
          email: order.email,
          address: order.address,
          pincode: Number(order.pin),
          city: order.city,
          state,
          country: "India",
          phone: Number(phone)
        },
        items: order.items.map((item) => ({
          name: item.name,
          qty: item.qty,
          price: item.unitPrice,
          sku: item.id
        })),
        package: packageDetails
      }
    });
    if (typeof data.order_id !== "string" || !data.order_id.trim()) {
      throw new NimbusPostError("NimbusPost did not return an order ID.");
    }
    return data.order_id.trim();
  }

  async function bookOrder(orderId) {
    requireConfigured();
    const data = await request("/v2/shipments/book", {
      method: "POST",
      body: { order_id: orderId }
    });
    const shipment = shipmentFrom(data);
    if (!shipment) throw new NimbusPostError("NimbusPost did not return an airway bill number.");
    return shipment;
  }

  async function ensureBooked(orderId) {
    requireConfigured();
    const existing = await request(`/v2/orders/${encodeURIComponent(orderId)}`);
    const shipment = shipmentFrom(existing);
    return shipment || bookOrder(orderId);
  }

  return {
    configured,
    createOrder,
    ensureBooked
  };
}
