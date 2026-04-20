const { google } = require("googleapis");
const config = require("../config");

const TAB_NAMES = {
  inventory: "Inventory",
  invoice: "Invoice",
  purchase: "Purchase",
  customers: "Customers",
  whitelist: "Whitelist",
  groups: "Groups",
  admin: "AdminConfig"
};

class SheetsService {
  constructor() {
    this.sheetId = config.sheets.sheetId;
    this.ready = false;
  }

  async init() {
    if (!this.sheetId || !config.sheets.serviceEmail || !config.sheets.privateKey) {
      console.warn("Google Sheets credentials missing. Sheets sync disabled.");
      return;
    }
    const auth = new google.auth.JWT(
      config.sheets.serviceEmail,
      null,
      config.sheets.privateKey,
      ["https://www.googleapis.com/auth/spreadsheets"]
    );
    this.sheets = google.sheets({ version: "v4", auth });
    
    try {
      await this.ensureTabsExist();
      this.ready = true;
    } catch (error) {
      console.error("Sheets initialization/tab check failed:", error.message);
      // We don't set ready to true if we can't even get sheet info (likely permission or ID issue)
    }
  }

  async ensureTabsExist() {
    const spreadsheet = await this.sheets.spreadsheets.get({
      spreadsheetId: this.sheetId
    });
    const existingTabs = spreadsheet.data.sheets.map(s => s.properties.title);
    const requiredTabs = Object.values(TAB_NAMES);
    const missingTabs = requiredTabs.filter(tab => !existingTabs.includes(tab));

    if (missingTabs.length > 0) {
      console.log(`Creating missing tabs: ${missingTabs.join(", ")}`);
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.sheetId,
        requestBody: {
          requests: missingTabs.map(title => ({
            addSheet: { properties: { title } }
          }))
        }
      });
      
      // Initialize headers for new tabs
      for (const tab of missingTabs) {
        let headers = [];
        if (tab === TAB_NAMES.inventory) headers = [["Model", "Part", "Stock", "Price", "Compatible"]];
        if (tab === TAB_NAMES.invoice) headers = [["Date", "Customer", "Model", "Part", "Qty", "Price", "Total"]];
        if (tab === TAB_NAMES.purchase) headers = [["Date", "Model", "Part", "Qty", "Cost", "Supplier"]];
        if (tab === TAB_NAMES.customers) headers = [["Number", "Shop", "Location", "Type"]];
        if (tab === TAB_NAMES.whitelist) headers = [["Number", "Label"]];
        if (tab === TAB_NAMES.groups) headers = [["GroupId", "GroupName"]];
        if (tab === TAB_NAMES.admin) headers = [["Key", "Value"]];
        
        if (headers.length) {
          await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.sheetId,
            range: `${tab}!A1`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: headers }
          });
        }
      }
    }
  }

  getServiceEmail() {
    return config.sheets.serviceEmail;
  }

  handleError(error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("caller does not have permission") || error.code === 403) {
      throw new Error(`PERMISSIONS_ERROR: The Google Service Account (${config.sheets.serviceEmail}) does not have permission. Please share the sheet with this email as EDITOR.`);
    }
    if (msg.includes("unable to parse range") || msg.includes("range") || error.code === 400) {
      throw new Error(`STRUCTURE_ERROR: Sheet tab "${TAB_NAMES.inventory}" (or others) could not be found or initialized. I am attempting to fix this. Please refresh in 10 seconds.`);
    }
    throw error;
  }

  async read(tab, range = "A:Z") {
    if (!this.ready) return [];
    try {
      const result = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetId,
        range: `${tab}!${range}`
      });
      return result.data.values || [];
    } catch (error) {
      this.handleError(error);
    }
  }

  async appendRow(tab, row) {
    if (!this.ready) return;
    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.sheetId,
        range: `${tab}!A:Z`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [row]
        }
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  async updateRange(tab, range, values) {
    if (!this.ready) return;
    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.sheetId,
        range: `${tab}!${range}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values }
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  async findInventoryItem(model, part) {
    const rows = await this.read(TAB_NAMES.inventory);
    if (rows.length <= 1) return null;
    const [header, ...data] = rows;
    const mapIndex = Object.fromEntries(header.map((name, idx) => [String(name).toLowerCase(), idx]));
    const modelIdx = mapIndex.model ?? 0;
    const partIdx = mapIndex.part ?? 1;
    const stockIdx = mapIndex.stock ?? 2;
    const priceIdx = mapIndex.price ?? 3;
    const compatibleIdx = mapIndex.compatible ?? 4;

    const foundIndex = data.findIndex((r) =>
      String(r[modelIdx] || "").toLowerCase() === model.toLowerCase() &&
      String(r[partIdx] || "").toLowerCase() === part.toLowerCase()
    );

    if (foundIndex === -1) return null;

    const row = data[foundIndex];
    return {
      rowNumber: foundIndex + 2,
      model: row[modelIdx],
      part: row[partIdx],
      stock: Number(row[stockIdx] || 0),
      price: Number(row[priceIdx] || 0),
      compatible: row[compatibleIdx] || ""
    };
  }

  async reduceStock(model, part, qty) {
    const item = await this.findInventoryItem(model, part);
    if (!item) throw new Error("Inventory item not found");
    if (item.stock < qty) throw new Error("Insufficient stock");

    const newStock = item.stock - qty;
    await this.updateRange(TAB_NAMES.inventory, `C${item.rowNumber}`, [[newStock]]);
    return { ...item, stock: newStock };
  }

  async createInvoice({ customer, model, part, qty, price }) {
    const total = qty * price;
    const date = new Date().toISOString();
    await this.appendRow(TAB_NAMES.invoice, [date, customer, model, part, qty, price, total]);
    return { date, total };
  }

  async getCustomerByNumber(phone) {
    const rows = await this.read(TAB_NAMES.customers);
    if (rows.length <= 1) return null;
    const [header, ...data] = rows;
    const mapIndex = Object.fromEntries(header.map((name, idx) => [String(name).toLowerCase(), idx]));
    const phoneIdx = mapIndex.number ?? 0;
    const shopIdx = mapIndex.shop ?? 1;
    const locationIdx = mapIndex.location ?? 2;
    const typeIdx = mapIndex.type ?? 3;
    const row = data.find((r) => String(r[phoneIdx] || "").trim() === String(phone).trim());
    if (!row) return null;
    return {
      number: row[phoneIdx] || "",
      shop: row[shopIdx] || "Unknown",
      location: row[locationIdx] || "Unknown",
      type: row[typeIdx] || "Retail"
    };
  }

  async isWhitelisted(phone) {
    const rows = await this.read(TAB_NAMES.whitelist);
    if (rows.length <= 1) return true;
    const [header, ...data] = rows;
    const numberIndex = header.findIndex((h) => String(h).toLowerCase() === "number");
    const idx = numberIndex === -1 ? 0 : numberIndex;
    return data.some((row) => String(row[idx] || "").trim() === String(phone).trim());
  }

  async setAdminConfigValue(key, value) {
    const rows = await this.read(TAB_NAMES.admin);
    const [header, ...data] = rows;
    if (!header || !header.length) {
      await this.updateRange(TAB_NAMES.admin, "A1:B2", [["Key", "Value"], [key, value]]);
      return;
    }

    const keyIdx = header.findIndex((h) => String(h).toLowerCase() === "key");
    const valueIdx = header.findIndex((h) => String(h).toLowerCase() === "value");
    const k = keyIdx === -1 ? 0 : keyIdx;
    const v = valueIdx === -1 ? 1 : valueIdx;
    const existing = data.findIndex((r) => String(r[k] || "").toLowerCase() === key.toLowerCase());
    if (existing === -1) {
      await this.appendRow(TAB_NAMES.admin, [key, value]);
      return;
    }
    const rowNumber = existing + 2;
    await this.updateRange(TAB_NAMES.admin, `B${rowNumber}`, [[value]]);
  }
}

module.exports = {
  SheetsService,
  TAB_NAMES
};
