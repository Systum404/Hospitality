import { AppError } from "../middleware/errorHandler.js";
import { getCustomerBilling } from "../services/customerBillingService.js";
import { createCustomerReceiptPdf, UnsupportedReceiptCharacterError } from "../services/customerBillingPdfService.js";

const capability = req => req.get("x-order-tracking-capability");
const rejectQuery = req => {
  if (Object.keys(req.query).length) {
    throw new AppError("Customer billing does not accept query parameters.", { code: "INVALID_CUSTOMER_BILLING_REQUEST", statusCode: 400 });
  }
};

export async function get(req, res, next) {
  try {
    rejectQuery(req);
    const billing = await getCustomerBilling(capability(req));
    res.json({ status: "success", data: { billing } });
  } catch (error) {
    next(error);
  }
}

export async function pdf(req, res, next) {
  try {
    rejectQuery(req);
    const billing = await getCustomerBilling(capability(req));
    if (!billing.available || billing.status !== "PAID") {
      throw new AppError("Receipt not available yet.", { code: "RECEIPT_NOT_AVAILABLE", statusCode: 409 });
    }
    const document = await createCustomerReceiptPdf(billing);
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${billing.invoice_number}-receipt.pdf"`);
    res.set("Content-Length", String(document.length));
    res.send(document);
  } catch (error) {
    if (error instanceof UnsupportedReceiptCharacterError) {
      return next(new AppError("The receipt contains text that cannot be represented by the embedded font.", {
        code: "RECEIPT_PDF_UNSUPPORTED_TEXT",
        statusCode: 422,
      }));
    }
    next(error);
  }
}

