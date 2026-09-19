import {
  isSupabaseConfigured,
  supabase,
  supabaseLoadError,
} from "./supabase-client.js";

const form = document.querySelector("#support-form");
const nameInput = document.querySelector("#full-name");
const mobileInput = document.querySelector("#mobile");
const addressInput = document.querySelector("#address");
const consentInput = document.querySelector("#consent");
const nameError = document.querySelector("#full-name-error");
const consentError = document.querySelector("#consent-error");
const formMessage = document.querySelector("#form-message");
const submitButton = document.querySelector("#submit-button");
const campaignTitle = document.querySelector("#campaign-title");
const letterHeading = document.querySelector("#letter-heading");
const letterBody = document.querySelector("#letter-body");
const supportCount = document.querySelector("#support-count");
const campaignStatus = document.querySelector("#campaign-status");
const updatedAt = document.querySelector("#updated-at");
const letterVersion = document.querySelector("#letter-version");

const numberFormatter = new Intl.NumberFormat("ar");
const dateFormatter = new Intl.DateTimeFormat("ar", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

let activeCampaign = null;

function showMessage(message, type = "error") {
  formMessage.className = `form-message ${type}`;
  formMessage.textContent = message;
  formMessage.hidden = false;
}

function clearErrors() {
  nameInput.removeAttribute("aria-invalid");
  consentInput.removeAttribute("aria-invalid");
  nameError.textContent = "";
  consentError.textContent = "";
  formMessage.hidden = true;
}

function validateForm() {
  clearErrors();
  let isValid = true;

  if (nameInput.value.trim().length < 2) {
    nameInput.setAttribute("aria-invalid", "true");
    nameError.textContent = "يرجى كتابة الاسم الكامل.";
    isValid = false;
  }

  if (!consentInput.checked) {
    consentInput.setAttribute("aria-invalid", "true");
    consentError.textContent = "يجب الموافقة على تسجيل التأييد.";
    isValid = false;
  }

  return isValid;
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy || !activeCampaign?.is_open;
  submitButton.querySelector("span").textContent = isBusy
    ? "جارٍ التسجيل…"
    : "تسجيل تأييدي";
}

function setCampaignStatus(isOpen, label) {
  campaignStatus.classList.toggle("closed", !isOpen);
  campaignStatus.querySelector("span").textContent = label;
  submitButton.disabled = !isOpen;
}

function renderLetterParagraphs(text) {
  letterBody.replaceChildren();
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    const element = document.createElement("p");
    element.textContent = paragraph;
    letterBody.append(element);
  }
}

function renderCampaign(campaign) {
  activeCampaign = campaign;
  campaignTitle.textContent = campaign.headline;
  letterHeading.textContent = campaign.letter_title;
  renderLetterParagraphs(campaign.letter_body);
  supportCount.textContent = numberFormatter.format(campaign.signature_count ?? 0);
  updatedAt.textContent = dateFormatter.format(new Date(campaign.updated_at));
  updatedAt.dateTime = campaign.updated_at;
  letterVersion.textContent = `نسخة الرسالة ${numberFormatter.format(campaign.version)}`;

  setCampaignStatus(
    campaign.is_open,
    campaign.is_open ? "الحملة مفتوحة" : "الحملة مغلقة",
  );
}

async function loadCampaign() {
  if (!isSupabaseConfigured || !supabase) {
    setCampaignStatus(false, "وضع المعاينة");
    supportCount.textContent = "—";
    return;
  }

  const { data, error } = await supabase.rpc("get_public_campaign");
  if (error) {
    console.error("Unable to load campaign", error);
    setCampaignStatus(false, "تعذّر تحميل الحملة");
    return;
  }

  const campaign = Array.isArray(data) ? data[0] : data;
  if (!campaign) {
    setCampaignStatus(false, "لا توجد حملة منشورة");
    return;
  }

  renderCampaign(campaign);
}

function friendlySubmissionError(error) {
  const message = `${error?.message ?? ""}`;
  if (message.includes("DUPLICATE_MOBILE")) {
    return "تم تسجيل هذا الهاتف في الحملة من قبل.";
  }
  if (message.includes("CAMPAIGN_CLOSED")) {
    return "التسجيل في هذه الحملة مغلق حاليًا.";
  }
  if (message.includes("INVALID_NAME")) {
    return "يرجى كتابة اسم صحيح.";
  }
  return "تعذّر حفظ التأييد الآن. يرجى المحاولة مرة أخرى.";
}

async function submitSupport(payload) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("SUPABASE_NOT_CONFIGURED");
  }
  if (!activeCampaign?.is_open) {
    throw new Error("CAMPAIGN_CLOSED");
  }

  const { data, error } = await supabase.rpc("submit_signature", {
    p_campaign_id: activeCampaign.id,
    p_full_name: payload.fullName,
    p_mobile: payload.mobile || null,
    p_address: payload.address || null,
    p_accepted: true,
  });

  if (error) throw error;
  return data;
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!validateForm()) return;

  if (!isSupabaseConfigured || !supabase) {
    showMessage("يلزم أولًا ربط الموقع بمشروع Supabase من ملف الإعداد.");
    return;
  }

  setBusy(true);
  try {
    await submitSupport({
      fullName: nameInput.value.trim(),
      mobile: mobileInput.value.trim(),
      address: addressInput.value.trim(),
    });

    form.reset();
    showMessage("شكرًا لك. تم تسجيل تأييدك بنجاح.", "success");
    await loadCampaign();
  } catch (error) {
    showMessage(friendlySubmissionError(error));
  } finally {
    setBusy(false);
  }
});

function registerWebMcpTool() {
  const context = document.modelContext;
  if (!context?.registerTool) return;

  const lifecycle = new AbortController();
  try {
    void Promise.resolve(
      context.registerTool(
        {
          name: "submit_campaign_support",
          title: "تسجيل تأييد للحملة",
          description:
            "يسجل تأييد شخص للرسالة الحالية بعد موافقته الصريحة. الاسم مطلوب والهاتف والعنوان اختياريان.",
          inputSchema: {
            type: "object",
            properties: {
              fullName: { type: "string", minLength: 2, maxLength: 100 },
              mobile: { type: "string", maxLength: 30 },
              address: { type: "string", maxLength: 180 },
              accepted: { type: "boolean", const: true },
            },
            required: ["fullName", "accepted"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          async execute(input) {
            if (!input || input.accepted !== true || `${input.fullName ?? ""}`.trim().length < 2) {
              throw new Error("يلزم اسم صحيح وموافقة صريحة.");
            }

            nameInput.value = `${input.fullName}`.trim();
            mobileInput.value = `${input.mobile ?? ""}`.trim();
            addressInput.value = `${input.address ?? ""}`.trim();
            consentInput.checked = true;
            setBusy(true);
            try {
              const signatureId = await submitSupport({
                fullName: nameInput.value,
                mobile: mobileInput.value,
                address: addressInput.value,
              });
              form.reset();
              showMessage("شكرًا لك. تم تسجيل تأييدك بنجاح.", "success");
              await loadCampaign();
              return { signatureId, status: "registered" };
            } finally {
              setBusy(false);
            }
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch((error) => console.error("WebMCP registration failed", error));
  } catch (error) {
    console.error("WebMCP registration failed", error);
  }
}

if (supabaseLoadError) {
  console.error("Supabase library could not be loaded", supabaseLoadError);
}

await loadCampaign();
registerWebMcpTool();
