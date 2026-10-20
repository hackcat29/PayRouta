/*! PayRouta checkout button v1 · https://payrouta.com/docs/checkout-button
 *
 * One button on any site or app. The customer pays in a secure PayRouta
 * window with any method the merchant accepts: card, bank transfer, mobile
 * money, credit from a licensed lender, stablecoins or crypto from any
 * wallet and chain.
 *
 *   <script src="https://<payrouta>/js/v1/payrouta.js" async></script>
 *   <button data-payrouta-checkout="/create-checkout">Checkout</button>
 *
 * The attribute names an endpoint on YOUR server. It creates a PayRouta
 * checkout session with your secret key and answers { "checkoutUrl": "…" }.
 * Your secret key never reaches the browser, and this script never sees card
 * details or wallet keys: payment happens on PayRouta's own origin.
 *
 * Events, dispatched on the button (and passed to onEvent):
 *   payrouta:open       the secure window opened
 *   payrouta:confirmed  the payment was confirmed; detail.returnUrl
 *   payrouta:pending    the provider is still confirming the payment
 *   payrouta:closed     the customer closed the window
 *   payrouta:error      the session could not be created or opened
 * By default "confirmed" sends the page to the payment's return URL; call
 * event.preventDefault() to handle it yourself. Always confirm the payment
 * on your server (webhook or GET /payments/{id}) before fulfilling: browser
 * events can be faked.
 */
(function () {
  "use strict";
  if (window.PayRouta && window.PayRouta.version) return;

  var script = document.currentScript;
  // Checkout lives where this script is served from, unless the tag names
  // the checkout origin with data-payrouta-origin (script on a CDN).
  var origin = (function () {
    try {
      var named = script && script.getAttribute("data-payrouta-origin");
      return new URL(named || (script && script.src) || location.href).origin;
    } catch {
      return location.origin;
    }
  })();
  var WINDOW = "payrouta-checkout";
  var active = null;

  function emit(target, onEvent, name, detail) {
    var event = new CustomEvent("payrouta:" + name, { detail: detail || {}, bubbles: true, cancelable: true });
    if (target) target.dispatchEvent(event);
    if (typeof onEvent === "function") {
      try {
        onEvent(name, detail || {}, event);
      } catch (e) {
        setTimeout(function () {
          throw e;
        });
      }
    }
    return event;
  }

  // Only PayRouta's own checkout pages may be opened.
  function checkoutUrl(value) {
    var raw = value && (value.checkoutUrl || value.url || value.checkoutPath || value);
    if (typeof raw !== "string") throw new Error("PAYROUTA_SESSION_INVALID");
    var url = new URL(raw, origin);
    if (url.origin !== origin || url.pathname.indexOf("/checkout/") !== 0 || !url.hash)
      throw new Error("PAYROUTA_SESSION_INVALID");
    return url;
  }

  function fetchSession(endpoint) {
    return fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: "{}",
    }).then(function (r) {
      if (!r.ok) throw new Error("PAYROUTA_SESSION_FAILED");
      return r.json();
    });
  }

  function popupFeatures() {
    var w = Math.min(520, screen.availWidth || 520);
    var h = Math.min(760, screen.availHeight || 760);
    var left = (window.screenX || 0) + Math.max(0, ((window.outerWidth || w) - w) / 2);
    var top = (window.screenY || 0) + Math.max(0, ((window.outerHeight || h) - h) / 2);
    return "popup=yes,width=" + w + ",height=" + h + ",left=" + left + ",top=" + top;
  }

  // A dimmed layer over the merchant's page while the window is open.
  function overlay(onFocus, onCancel) {
    var host = document.createElement("div");
    host.setAttribute("data-payrouta-overlay", "");
    var root = host.attachShadow ? host.attachShadow({ mode: "closed" }) : host;
    root.innerHTML =
      "<style>" +
      ":host,div.o{all:initial}" +
      ".o{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;background:rgba(9,22,27,.72);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#fff;text-align:center;padding:16px}" +
      ".b{max-width:340px;display:grid;gap:14px;justify-items:center}" +
      "strong{font-size:17px;font-weight:600}" +
      "button{font:inherit;cursor:pointer;border-radius:8px;padding:10px 18px;border:1px solid rgba(255,255,255,.4);background:#fff;color:#0e1f25;font-weight:600}" +
      "button.l{background:none;color:#fff;border:0;text-decoration:underline;font-weight:400;padding:4px}" +
      "button:focus-visible{outline:3px solid #7fd6cd;outline-offset:2px}" +
      "</style>" +
      '<div class="o" role="dialog" aria-modal="true" aria-label="PayRouta checkout"><div class="b">' +
      "<strong>Complete your payment in the secure PayRouta window</strong>" +
      "<span>Can’t see it? We’ll bring it back.</span>" +
      '<button type="button" class="f">Continue to payment</button>' +
      '<button type="button" class="l">Cancel</button>' +
      "</div></div>";
    root.querySelector(".f").addEventListener("click", onFocus);
    root.querySelector(".l").addEventListener("click", onCancel);
    document.body.appendChild(host);
    root.querySelector(".f").focus();
    return function () {
      if (host.parentNode) host.parentNode.removeChild(host);
    };
  }

  // Opens checkout. `session` is your endpoint's URL, a checkout URL, or a
  // function returning (a promise of) either. Resolves with the final event.
  function checkout(options) {
    options = options || {};
    var target = options.element || null;
    var onEvent = options.onEvent;
    var redirect = options.mode === "redirect";
    if (active) {
      active.focus();
      return active.done;
    }
    // Open the window synchronously, inside the click, so it isn't blocked.
    var popup = redirect ? null : window.open("about:blank", WINDOW, popupFeatures());
    var session = options.session;
    var pending =
      typeof session === "function"
        ? Promise.resolve().then(session)
        : typeof session === "string" && session.indexOf("/checkout/") === -1
          ? fetchSession(session)
          : Promise.resolve(session);

    var resolveDone;
    var done = new Promise(function (resolve) {
      resolveDone = resolve;
    });
    var state = { popup: popup, done: done, focus: function () {} };
    active = state;

    function finish(name, detail) {
      if (active !== state) return;
      active = null;
      window.removeEventListener("message", onMessage);
      clearInterval(watch);
      removeOverlay();
      var event = emit(target, onEvent, name, detail);
      if (name === "confirmed" && !event.defaultPrevented && detail && detail.returnUrl) location.assign(detail.returnUrl);
      resolveDone({ event: name, detail: detail || {} });
    }
    function onMessage(e) {
      if (e.origin !== origin || !popup || e.source !== popup) return;
      var d = e.data;
      if (!d || d.type !== "payrouta:checkout") return;
      var detail = { reference: d.reference, returnUrl: d.returnUrl, method: d.method };
      if (d.event === "pending") emit(target, onEvent, "pending", detail);
      else if (d.event === "confirmed") {
        try {
          popup.close();
        } catch {}
        finish("confirmed", detail);
      } else if (d.event === "return") finish("closed", detail);
    }
    var removeOverlay = function () {};
    var watch = null;

    pending
      .then(function (value) {
        var url = checkoutUrl(value);
        if (redirect || !popup || popup.closed) {
          // No popup (blocked, or redirect mode): checkout takes the tab and
          // returns to the payment's return URL.
          active = null;
          location.assign(url.href);
          return;
        }
        url.searchParams.set("mode", "popup");
        popup.location.replace(url.href);
        state.focus = function () {
          try {
            popup.focus();
          } catch {}
        };
        window.addEventListener("message", onMessage);
        removeOverlay = overlay(state.focus, function () {
          try {
            popup.close();
          } catch {}
          finish("closed", {});
        });
        watch = setInterval(function () {
          if (popup.closed) finish("closed", {});
        }, 500);
        emit(target, onEvent, "open", {});
      })
      .catch(function (error) {
        if (popup && !popup.closed) popup.close();
        active = null;
        resolveDone({ event: "error", detail: { message: error && error.message } });
        emit(target, onEvent, "error", { message: (error && error.message) || "PAYROUTA_SESSION_FAILED" });
      });
    return done;
  }

  // <button data-payrouta-checkout="/your-endpoint" data-payrouta-mode="popup|redirect">
  function bind(root) {
    var nodes = (root || document).querySelectorAll("[data-payrouta-checkout]:not([data-payrouta-bound])");
    for (var i = 0; i < nodes.length; i++) {
      (function (el) {
        el.setAttribute("data-payrouta-bound", "");
        el.addEventListener("click", function (e) {
          e.preventDefault();
          if (el.getAttribute("aria-busy") === "true") return;
          el.setAttribute("aria-busy", "true");
          checkout({
            element: el,
            session: el.getAttribute("data-payrouta-checkout"),
            mode: el.getAttribute("data-payrouta-mode") || "popup",
          }).then(function () {
            el.removeAttribute("aria-busy");
          });
        });
      })(nodes[i]);
    }
  }

  window.PayRouta = { version: "1.0.0", origin: origin, checkout: checkout, bind: bind };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { bind(); });
  else bind();
  // Buttons added later (single-page apps).
  if (window.MutationObserver)
    new MutationObserver(function () {
      bind();
    }).observe(document.documentElement, { childList: true, subtree: true });
  document.dispatchEvent(new CustomEvent("payrouta:ready"));
})();
