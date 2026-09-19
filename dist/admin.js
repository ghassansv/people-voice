import { isSupabaseConfigured, supabase } from "./supabase-client.js";

const setupPanel = document.querySelector("#setup-panel");
const loginPanel = document.querySelector("#login-panel");
const loginForm = document.querySelector("#login-form");
const loginButton = document.querySelector("#login-button");
const loginMessage = document.querySelector("#login-message");
const dashboard = document.querySelector("#dashboard");
const adminActions = document.querySelector("#admin-actions");
const logoutButton = document.querySelector("#logout-button");
const adminIdentity = document.querySelector("#admin-identity");
const campaignForm = document.querySelector("#campaign-form");
const campaignHeadline = document.querySelector("#campaign-headline");
const letterTitleInput = document.querySelector("#letter-title-input");
const letterBodyInput = document.querySelector("#letter-body-input");
const campaignOpen = document.querySelector("#campaign-open");
const campaignMessage = document.querySelector("#campaign-message");
const saveCampaignButton = document.querySelector("#save-campaign-button");
const adminVersion = document.querySelector("#admin-version");
const adminSupportCount = document.querySelector("#admin-support-count");
const signaturesBody = document.querySelector("#signatures-body");
const signaturesEmpty = document.querySelector("#signatures-empty");
const signatureMessage = document.querySelector("#signature-message");
const signatureSearch = document.querySelector("#signature-search");
const exportButton = document.querySelector("#export-button");

const numberFormatter = new Intl.NumberFormat("ar");
const dateFormatter = new Intl.DateTimeFormat("ar", {
  dateStyle: "medium",
  timeStyle: "short",
});

let currentCampaign = null;
let recentSignatures = [];

function setMessage(element, message, type = "error") {
  element.className = `form-message ${type}`;
  element.textContent = message;
  element.hidden = false;
}

function hideMessage(element) {
  element.hidden = true;
}

function setButtonBusy(button, isBusy, busyLabel, idleLabel) {
  button.disabled = isBusy;
  const label = button.querySelector("span");
  if (label) label.textContent = isBusy ? busyLabel : idleLabel;
}

function showLogin() {
  loginPanel.hidden = false;
  dashboard.hidden = true;
  adminActions.hidden = true;
}

function showDashboard(user) {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  adminActions.hidden = false;
  adminIdentity.textContent = user.email ?? "حساب مسؤول";
}

async function isAuthorizedAdmin(userId) {
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function requireAdmin(session) {
  if (!session?.user) {
    showLogin();
    return false;
  }

  const authorized = await isAuthorizedAdmin(session.user.id);
  if (!authorized) {
    await supabase.auth.signOut();
    showLogin();
    setMessage(loginMessage, "هذا الحساب لا يملك صلاحية إدارة الحملة.");
    return false;
  }

  showDashboard(session.user);
  return true;
}

function fillCampaignForm(campaign) {
  currentCampaign = campaign;
  campaignHeadline.value = campaign.headline;
  letterTitleInput.value = campaign.letter_title;
  letterBodyInput.value = campaign.letter_body;
  campaignOpen.checked = campaign.is_open;
  adminVersion.textContent = `النسخة ${numberFormatter.format(campaign.version)}`;
}

function createCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value || "—";
  return cell;
}

function renderSignatures(rows) {
  signaturesBody.replaceChildren();
  signaturesEmpty.hidden = rows.length !== 0;

  for (const signature of rows) {
    const row = document.createElement("tr");
    const actionCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-signature-button";
    deleteButton.dataset.signatureId = signature.id;
    deleteButton.textContent = "حذف";
    deleteButton.setAttribute("aria-label", `حذف تسجيل ${signature.full_name}`);
    actionCell.append(deleteButton);
    row.append(
      createCell(signature.full_name),
      createCell(signature.mobile),
      createCell(signature.address),
      createCell(numberFormatter.format(signature.campaign_version)),
      createCell(dateFormatter.format(new Date(signature.created_at))),
      actionCell,
    );
    signaturesBody.append(row);
  }
}

async function loadDashboard() {
  const [campaignResult, signaturesResult, countResult] = await Promise.all([
    supabase.from("campaigns").select("*").eq("is_active", true).single(),
    supabase
      .from("signatures")
      .select("id,full_name,mobile,address,campaign_version,created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("signatures").select("id", { count: "exact", head: true }),
  ]);

  if (campaignResult.error) throw campaignResult.error;
  if (signaturesResult.error) throw signaturesResult.error;
  if (countResult.error) throw countResult.error;

  fillCampaignForm(campaignResult.data);
  recentSignatures = signaturesResult.data ?? [];
  renderSignatures(recentSignatures);
  adminSupportCount.textContent = numberFormatter.format(countResult.count ?? 0);
  exportButton.disabled = (countResult.count ?? 0) === 0;
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideMessage(loginMessage);
  setButtonBusy(loginButton, true, "جارٍ الدخول…", "تسجيل الدخول");

  const email = document.querySelector("#admin-email").value.trim();
  const password = document.querySelector("#admin-password").value;

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const authorized = await requireAdmin(data.session);
    if (authorized) await loadDashboard();
  } catch (error) {
    console.error("Admin login failed", error);
    setMessage(loginMessage, "تعذّر تسجيل الدخول. تحقق من البريد وكلمة المرور والصلاحية.");
  } finally {
    setButtonBusy(loginButton, false, "جارٍ الدخول…", "تسجيل الدخول");
  }
});

logoutButton?.addEventListener("click", async () => {
  await supabase.auth.signOut();
  loginForm.reset();
  showLogin();
});

campaignForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideMessage(campaignMessage);
  setButtonBusy(saveCampaignButton, true, "جارٍ الحفظ…", "حفظ التغييرات");

  try {
    const { error } = await supabase
      .from("campaigns")
      .update({
        headline: campaignHeadline.value.trim(),
        letter_title: letterTitleInput.value.trim(),
        letter_body: letterBodyInput.value.trim(),
        is_open: campaignOpen.checked,
      })
      .eq("id", currentCampaign.id);

    if (error) throw error;
    await loadDashboard();
    setMessage(campaignMessage, "تم حفظ التغييرات ونشرها في الصفحة العامة.", "success");
  } catch (error) {
    console.error("Campaign save failed", error);
    setMessage(campaignMessage, "تعذّر حفظ التغييرات. يرجى المحاولة مرة أخرى.");
  } finally {
    setButtonBusy(saveCampaignButton, false, "جارٍ الحفظ…", "حفظ التغييرات");
  }
});

signatureSearch?.addEventListener("input", () => {
  const term = signatureSearch.value.trim().toLocaleLowerCase("ar");
  if (!term) {
    renderSignatures(recentSignatures);
    return;
  }

  renderSignatures(
    recentSignatures.filter((signature) =>
      [signature.full_name, signature.mobile, signature.address]
        .filter(Boolean)
        .some((value) => value.toLocaleLowerCase("ar").includes(term)),
    ),
  );
});

signaturesBody?.addEventListener("click", async (event) => {
  const button = event.target.closest(".delete-signature-button");
  if (!button) return;

  const signature = recentSignatures.find((row) => row.id === button.dataset.signatureId);
  if (!signature) return;

  const details = [signature.full_name, signature.mobile, dateFormatter.format(new Date(signature.created_at))]
    .filter(Boolean)
    .join(" — ");
  if (!window.confirm(`هل تريد حذف هذا التسجيل نهائيًا؟\n${details}\nلا يمكن التراجع عن الحذف.`)) return;

  hideMessage(signatureMessage);
  button.disabled = true;
  button.textContent = "جارٍ الحذف…";
  let deleted = false;

  try {
    const { data, error } = await supabase
      .from("signatures")
      .delete()
      .eq("id", signature.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("SIGNATURE_NOT_DELETED");
    deleted = true;
    await loadDashboard();
    setMessage(signatureMessage, `تم حذف تسجيل ${signature.full_name}.`, "success");
  } catch (error) {
    console.error("Signature deletion failed", error);
    setMessage(
      signatureMessage,
      deleted
        ? "تم الحذف، لكن تعذّر تحديث القائمة. أعد تحميل الصفحة."
        : "تعذّر حذف التسجيل. تحقق من صلاحية الحذف في Supabase وحاول مجددًا.",
    );
  } finally {
    button.disabled = false;
    button.textContent = "حذف";
  }
});

function csvCell(value) {
  const raw = `${value ?? ""}`;
  // Spreadsheet apps may evaluate cells beginning with formula operators.
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

async function loadAllSignatures() {
  const pageSize = 1000;
  const rows = [];

  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from("signatures")
      .select("full_name,mobile,address,campaign_version,consented_at,created_at")
      .order("created_at", { ascending: true })
      .range(start, start + pageSize - 1);

    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

exportButton?.addEventListener("click", async () => {
  exportButton.disabled = true;
  const originalLabel = exportButton.textContent;
  exportButton.textContent = "جارٍ تجهيز الملف…";

  try {
    const rows = await loadAllSignatures();
    const headers = ["الاسم الكامل", "رقم الهاتف", "العنوان", "نسخة الرسالة", "وقت الموافقة", "وقت التسجيل"];
    const lines = [headers.map(csvCell).join(",")];

    for (const row of rows) {
      lines.push(
        [row.full_name, row.mobile, row.address, row.campaign_version, row.consented_at, row.created_at]
          .map(csvCell)
          .join(","),
      );
    }

    const blob = new Blob(["\ufeff", lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `campaign-signatures-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Export failed", error);
    window.alert("تعذّر تجهيز ملف التصدير.");
  } finally {
    exportButton.textContent = originalLabel;
    exportButton.disabled = false;
  }
});

async function initialize() {
  if (!isSupabaseConfigured || !supabase) {
    setupPanel.hidden = false;
    loginPanel.hidden = true;
    return;
  }

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const authorized = await requireAdmin(data.session);
    if (authorized) await loadDashboard();
  } catch (error) {
    console.error("Admin initialization failed", error);
    showLogin();
    setMessage(loginMessage, "تعذّر تحميل لوحة الإدارة. تحقق من إعداد Supabase.");
  }
}

await initialize();
