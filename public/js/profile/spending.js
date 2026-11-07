import { $, setText } from "../core/dom.js";
import { number } from "../core/format.js";
import { hideAnimatedPopup, showAnimatedPopup } from "../core/popovers.js";

export function createSpending(getData) {
    const STANDARD_START_YEN = 267;
    const START_PRICES = [
        ["Light Start", 3, 206],
        ["Standard Start with EX-TRACK", 4, STANDARD_START_YEN],
        ["Premium Time (4 songs)", 4, 411],
    ];
    const popupYen = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "JPY",
    });
    const yen = new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
    });
    const formatMoney = (formatter, value) =>
        formatter
            .formatToParts(value)
            .map((part) => (part.type === "group" ? "\u202f" : part.value))
            .join("");

    let conversionCurrency = "EUR";
    let convertedMoney = new Intl.NumberFormat("en-IE", {
        style: "currency",
        currency: conversionCurrency,
    });
    let exchangeRate = null,
        exchangeRateDate = "",
        rateLoading = false,
        rateAttempt = 0;

    function renderSpending() {
        const data = getData();
        if (!data) return;
        const spending = (STANDARD_START_YEN * data.plays.length) / 4;
        const price = document.createElement("button");
        price.type = "button";
        price.className = "spending-price";
        price.textContent = formatMoney(yen, spending);
        price.setAttribute("aria-describedby", "spending-popup");
        price.setAttribute(
            "aria-label",
            `${formatMoney(yen, spending)} · View arcade spending estimates`,
        );
        price.addEventListener("pointerenter", (event) => {
            if (event.pointerType === "mouse") showSpendingPopup();
        });
        price.addEventListener("pointerleave", scheduleSpendingHide);
        price.addEventListener("focus", showSpendingPopup);
        price.addEventListener("blur", scheduleSpendingHide);
        price.addEventListener("click", showSpendingPopup);
        $("spending-total").replaceChildren(price);
        setText(
            "spending-detail",
            `${exchangeRate === null ? "" : `≈ ${formatMoney(convertedMoney, spending * exchangeRate)} · `}Standard Start`,
        );
        $("spending-description").textContent =
            `${number(data.plays.length)} plays on an arcade cabinet corresponds to:`;
        $("spending-options").replaceChildren(
            ...START_PRICES.map(([label, songs, cost]) => {
                const amount = (data.plays.length / songs) * cost;
                const item = document.createElement("li");
                item.textContent = `${label}: ${formatMoney(popupYen, amount)}${exchangeRate === null ? "" : ` (≈ ${formatMoney(convertedMoney, amount * exchangeRate)})`}`;
                return item;
            }),
        );
    }

    let spendingHideTimer;
    function hideSpendingPopup() {
        clearTimeout(spendingHideTimer);
        hideAnimatedPopup($("spending-popup"));
    }
    function scheduleSpendingHide(event) {
        const pointerLeft = event?.pointerType === "mouse";
        clearTimeout(spendingHideTimer);
        spendingHideTimer = setTimeout(() => {
            if (
                pointerLeft ||
                !document.activeElement?.matches(".spending-price")
            )
                hideSpendingPopup();
        }, 150);
    }
    function showSpendingPopup() {
        clearTimeout(spendingHideTimer);
        const popup = $("spending-popup");
        const trigger = document.querySelector(".spending-price");
        if (!trigger) return;
        showAnimatedPopup(popup, trigger);
    }

    async function loadExchangeRate() {
        const data = getData();
        const requested = /^[A-Z]{3}$/.test(data?.state.currency || "")
            ? data.state.currency
            : "EUR";
        if (requested !== conversionCurrency) {
            conversionCurrency = requested;
            convertedMoney = new Intl.NumberFormat("en-IE", {
                style: "currency",
                currency: requested,
            });
            exchangeRate = null;
            exchangeRateDate = "";
            rateAttempt = 0;
            rateLoading = false;
            renderSpending();
        }
        if (requested === "JPY") {
            exchangeRate = null;
            renderSpending();
            return;
        }
        const retryAfter = exchangeRate === null ? 60000 : 3600000;
        if (rateLoading || Date.now() - rateAttempt < retryAfter) return;
        rateLoading = true;
        rateAttempt = Date.now();
        try {
            const response = await fetch(
                `https://api.frankfurter.dev/v2/rate/jpy/${requested.toLowerCase()}`,
                {
                    signal: AbortSignal.timeout(5000),
                },
            );
            if (!response.ok) throw new Error("Rate unavailable");
            const result = await response.json();
            if (
                result.base !== "JPY" ||
                result.quote !== requested ||
                !Number.isFinite(result.rate) ||
                result.rate <= 0 ||
                !/^\d{4}-\d{2}-\d{2}$/.test(result.date)
            )
                throw new Error("Invalid rate");
            if (requested !== conversionCurrency) return;
            exchangeRate = result.rate;
            exchangeRateDate = result.date;
            renderSpending();
        } catch {
            // Keep the yen amount (and any previously loaded conversion) available
        } finally {
            if (requested === conversionCurrency) rateLoading = false;
        }
    }

    document.addEventListener("click", (event) => {
        if (!event.target.closest(".spending-price, #spending-popup"))
            hideSpendingPopup();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") hideSpendingPopup();
    });
    window.addEventListener(
        "scroll",
        (event) => {
            if (event.target !== $("spending-popup")) hideSpendingPopup();
        },
        { capture: true, passive: true },
    );
    window.addEventListener("resize", hideSpendingPopup);

    return { render: renderSpending, loadExchangeRate };
}
