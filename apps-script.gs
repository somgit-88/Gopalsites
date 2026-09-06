/**
 * GOPALSITES — GOOGLE APPS SCRIPT BACKEND
 * ------------------------------------------------------------
 * Connects your website to your Google Sheet (design catalogue,
 * categories, facilities, pricing, settings, leads, payments)
 * and to Telegram + your payment gateway (Razorpay or Instamojo).
 *
 * See SETUP.md for full step-by-step instructions.
 *
 * SECURITY NOTE: All API keys and tokens live only in this
 * server-side script (read from the "Settings" sheet) — they are
 * never sent to the browser.
 * ------------------------------------------------------------
 */

const SPREADSHEET_ID = "YOUR_GOOGLE_SHEET_ID_HERE"; // from the Sheet's URL

const SHEETS = {
  DESIGNS: "Website Designs",
  CATEGORIES: "Categories",
  FACILITIES: "Facilities",
  PRICING: "Pricing",
  SETTINGS: "Settings",
  LEADS: "Leads",
  PAYMENTS: "Payments",
};

/* ============================================================
   ROUTER
   ============================================================ */
function doGet(e) {
  const action = e.parameter.action;

  if (action === "config") return jsonResponse(getPublicConfig());
  if (action === "verifyPayment") return jsonResponse(verifyPayment(e.parameter));

  return jsonResponse({ error: "Unknown action" });
}

function doPost(e) {
  try {
    // Instamojo webhooks arrive as normal form fields, not JSON
    if (e.postData.type === "application/x-www-form-urlencoded") {
      return handleInstamojoWebhook(e.parameter);
    }

    const body = JSON.parse(e.postData.contents);

    // Razorpay webhooks are JSON but have an "event" field, no "action"
    if (body.event) return handleRazorpayWebhook(body);

    if (body.action === "submitLead") {
      const leadId = saveLead(body.lead);
      sendTelegramMessage(formatLeadMessage(body.lead, leadId));
      return jsonResponse({ success: true, leadId: leadId });
    }

    if (body.action === "createPayment") {
      return jsonResponse(createPayment(body));
    }

    return jsonResponse({ success: false, error: "Unknown action" });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

/* ============================================================
   PUBLIC CONFIG — everything the frontend needs, all Sheet-driven
   ============================================================ */
function getPublicConfig() {
  const settings = getSettings();
  return {
    businessName: settings["Business Name"] || "GopalSites",
    startingFee: Number(settings["Starting Fee Amount"] || 500),
    whatsappNumber: settings["WhatsApp Number"] || "",
    contactEmail: settings["Contact Email"] || "",
    paymentGateway: settings["Payment Gateway"] || "Razorpay",
    designs: getRows(SHEETS.DESIGNS).filter(r => r.Status === "Active"),
    categories: getRows(SHEETS.CATEGORIES)
      .filter(r => r.Status === "Active")
      .sort((a, b) => (a["Sort Order"] || 0) - (b["Sort Order"] || 0)),
    facilities: getRows(SHEETS.FACILITIES)
      .filter(r => r.Status === "Active")
      .sort((a, b) => (a["Sort Order"] || 0) - (b["Sort Order"] || 0)),
    pricing: getRows(SHEETS.PRICING)
      .filter(r => r.Status === "Active")
      .sort((a, b) => (a["Sort Order"] || 0) - (b["Sort Order"] || 0)),
  };
}

/* ============================================================
   Generic sheet reader — returns array of objects keyed by header row
   ============================================================ */
function getRows(sheetName) {
  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values
    .filter(r => r.join("") !== "") // skip blank rows
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => (obj[h] = r[i]));
      return obj;
    });
}

function getSettings() {
  const rows = getRows(SHEETS.SETTINGS);
  const obj = {};
  rows.forEach(r => (obj[r.Key] = r.Value));
  return obj;
}

function getSheet(name) {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
}

/* ============================================================
   LEADS
   ============================================================ */
function saveLead(lead) {
  const sheet = getSheet(SHEETS.LEADS);
  const leadId = "L" + new Date().getTime();
  sheet.appendRow([
    leadId, new Date(), lead.name || "", lead.businessName || "",
    lead.email || "", lead.phone || "", lead.category || "",
    lead.selectedDesign || "", lead.selectedDesignId || "",
    lead.budget || "", lead.pages || "", lead.features || "",
    lead.message || "", "New", "", "", "Unpaid", 0,
  ]);
  return leadId;
}

function formatLeadMessage(lead, leadId) {
  return "🔔 NEW WEBSITE LEAD\n\n" +
    "Name: " + (lead.name || "-") + "\n" +
    "Business: " + (lead.businessName || "-") + "\n" +
    "Category: " + (lead.category || "-") + "\n" +
    "Selected Design: " + (lead.selectedDesign || "Not selected") + "\n" +
    "Budget: " + (lead.budget || "-") + "\n" +
    "Phone: " + (lead.phone || "-") + "\n" +
    "Email: " + (lead.email || "-") + "\n" +
    "Message: " + (lead.message || "-") + "\n\n" +
    "Status: NEW  (Lead ID: " + leadId + ")";
}

/* ============================================================
   PAYMENTS — create a payment link via the active gateway
   body: { amount, type, leadId, name, email, phone }
   ============================================================ */
function createPayment(body) {
  const settings = getSettings();
  const gateway = (settings["Payment Gateway"] || "Razorpay").trim();
  const amount = Number(body.amount);
  if (!amount || amount <= 0) return { success: false, error: "Invalid amount" };

  const paymentId = "P" + new Date().getTime();
  let checkoutUrl = "";
  let gatewayRef = "";

  if (gateway === "Razorpay") {
    const result = createRazorpayLink(settings, amount, body, paymentId);
    checkoutUrl = result.url;
    gatewayRef = result.ref;
  } else if (gateway === "Instamojo") {
    const result = createInstamojoLink(settings, amount, body, paymentId);
    checkoutUrl = result.url;
    gatewayRef = result.ref;
  } else {
    return { success: false, error: "Unknown payment gateway: " + gateway };
  }

  logPayment({
    paymentId, leadId: body.leadId || "", name: body.name || "",
    email: body.email || "", phone: body.phone || "", amount,
    type: body.type || "Custom Amount", gateway, gatewayRef, status: "Created",
  });

  return { success: true, checkoutUrl: checkoutUrl, paymentId: paymentId };
}

function createRazorpayLink(settings, amount, body, paymentId) {
  const keyId = settings["Razorpay Key ID"];
  const keySecret = settings["Razorpay Key Secret"];
  const redirectUrl = (settings["Site Redirect URL"] || "") + "?payment_id=" + paymentId + "&gateway=Razorpay";

  const res = UrlFetchApp.fetch("https://api.razorpay.com/v1/payment_links", {
    method: "post",
    headers: { Authorization: "Basic " + Utilities.base64Encode(keyId + ":" + keySecret) },
    contentType: "application/json",
    payload: JSON.stringify({
      amount: amount * 100, // paise
      currency: "INR",
      description: (body.type || "Payment") + " — " + (body.name || ""),
      customer: { name: body.name || "", email: body.email || "", contact: body.phone || "" },
      notify: { sms: true, email: true },
      reference_id: paymentId,
      callback_url: redirectUrl,
      callback_method: "get",
    }),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  return { url: data.short_url, ref: data.id };
}

function createInstamojoLink(settings, amount, body, paymentId) {
  const apiKey = settings["Instamojo API Key"];
  const authToken = settings["Instamojo Auth Token"];
  const isLive = (settings["Instamojo Mode"] || "test") === "live";
  const base = isLive ? "https://www.instamojo.com/api/1.1/" : "https://test.instamojo.com/api/1.1/";
  const redirectUrl = (settings["Site Redirect URL"] || "") + "?payment_id=" + paymentId + "&gateway=Instamojo";

  const res = UrlFetchApp.fetch(base + "payment-requests/", {
    method: "post",
    headers: { "X-Api-Key": apiKey, "X-Auth-Token": authToken },
    payload: {
      purpose: (body.type || "Payment") + " - " + (body.name || ""),
      amount: String(amount),
      buyer_name: body.name || "",
      email: body.email || "",
      phone: body.phone || "",
      redirect_url: redirectUrl,
      allow_repeated_payments: false,
    },
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  return { url: data.payment_request.longurl, ref: data.payment_request.id };
}

function logPayment(p) {
  const sheet = getSheet(SHEETS.PAYMENTS);
  sheet.appendRow([
    p.paymentId, new Date(), p.leadId, p.name, p.email, p.phone,
    p.amount, p.type, p.gateway, p.gatewayRef, p.status, "",
  ]);
}

/* ============================================================
   PAYMENT VERIFICATION — called by the frontend after redirect back
   from the gateway, using the payment_id we stored in the Payments sheet
   ============================================================ */
function verifyPayment(params) {
  const settings = getSettings();
  const sheet = getSheet(SHEETS.PAYMENTS);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const idCol = headers.indexOf("Payment ID");
  const statusCol = headers.indexOf("Status");
  const refCol = headers.indexOf("Gateway Reference ID");

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] === params.payment_id) {
      const gatewayRef = rows[i][refCol];
      let status = "Pending";

      if (params.gateway === "Razorpay") {
        status = checkRazorpayStatus(settings, gatewayRef);
      } else if (params.gateway === "Instamojo") {
        status = checkInstamojoStatus(settings, gatewayRef);
      }

      sheet.getRange(i + 1, statusCol + 1).setValue(status);
      if (status === "Paid") {
        sendTelegramMessage("💰 PAYMENT RECEIVED\n\nPayment ID: " + params.payment_id +
          "\nAmount: ₹" + rows[i][headers.indexOf("Amount")] +
          "\nFrom: " + rows[i][headers.indexOf("Name")]);
      }
      return { status: status };
    }
  }
  return { status: "Not found" };
}

function checkRazorpayStatus(settings, linkId) {
  const keyId = settings["Razorpay Key ID"];
  const keySecret = settings["Razorpay Key Secret"];
  const res = UrlFetchApp.fetch("https://api.razorpay.com/v1/payment_links/" + linkId, {
    headers: { Authorization: "Basic " + Utilities.base64Encode(keyId + ":" + keySecret) },
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  return data.status === "paid" ? "Paid" : (data.status || "Pending");
}

function checkInstamojoStatus(settings, requestId) {
  const apiKey = settings["Instamojo API Key"];
  const authToken = settings["Instamojo Auth Token"];
  const isLive = (settings["Instamojo Mode"] || "test") === "live";
  const base = isLive ? "https://www.instamojo.com/api/1.1/" : "https://test.instamojo.com/api/1.1/";
  const res = UrlFetchApp.fetch(base + "payment-requests/" + requestId + "/", {
    headers: { "X-Api-Key": apiKey, "X-Auth-Token": authToken },
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  const status = data.payment_request && data.payment_request.status;
  return status === "Completed" ? "Paid" : (status || "Pending");
}

/* ============================================================
   WEBHOOKS — gateways call these directly when a payment completes,
   as a backup to the redirect-based verifyPayment above.
   Configure these webhook URLs (this same deployment URL) in your
   Razorpay / Instamojo dashboard.
   ============================================================ */
function handleRazorpayWebhook(body) {
  if (body.event === "payment_link.paid") {
    const ref = body.payload.payment_link.entity.id;
    updatePaymentStatusByRef(ref, "Paid");
  }
  return jsonResponse({ received: true });
}

function handleInstamojoWebhook(params) {
  if (params.status === "Credit") {
    updatePaymentStatusByRef(params.payment_request_id, "Paid");
  }
  return jsonResponse({ received: true });
}

function updatePaymentStatusByRef(gatewayRef, status) {
  const sheet = getSheet(SHEETS.PAYMENTS);
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const refCol = headers.indexOf("Gateway Reference ID");
  const statusCol = headers.indexOf("Status");
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][refCol] === gatewayRef) {
      sheet.getRange(i + 1, statusCol + 1).setValue(status);
      if (status === "Paid") {
        sendTelegramMessage("💰 PAYMENT RECEIVED (webhook)\n\nAmount: ₹" +
          rows[i][headers.indexOf("Amount")] + "\nFrom: " + rows[i][headers.indexOf("Name")]);
      }
      return;
    }
  }
}

/* ============================================================
   TELEGRAM
   ============================================================ */
function sendTelegramMessage(text) {
  const settings = getSettings();
  const token = settings["Telegram Bot Token"];
  const chatId = settings["Telegram Chat ID"];
  if (!token || !chatId) return;
  UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ chat_id: chatId, text: text }),
    muteHttpExceptions: true,
  });
}

/* ============================================================
   Helper
   ============================================================ */
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
