(() => {
  const active = new WeakMap();

  function close(input) {
    const state = active.get(input);
    if (state && state.box) state.box.hidden = true;
  }

  function ensureBox(input) {
    let state = active.get(input);
    if (state) return state;
    const wrap = document.createElement("div");
    wrap.className = "address-autocomplete-wrap";
    input.parentNode.insertBefore(wrap,input);
    wrap.appendChild(input);

    const box = document.createElement("div");
    box.className = "address-suggestions";
    box.hidden = true;
    wrap.appendChild(box);

    state = { box, timer:null, controller:null };
    active.set(input,state);

    input.setAttribute("autocomplete","off");
    input.setAttribute("aria-autocomplete","list");

    input.addEventListener("input", () => {
      const q = input.value.trim();
      clearTimeout(state.timer);
      if (state.controller) state.controller.abort();
      if (q.length < 3) {
        box.hidden = true;
        box.innerHTML = "";
        return;
      }
      state.timer = setTimeout(async () => {
        state.controller = new AbortController();
        try {
          const r = await fetch("/api/address-autocomplete?q=" + encodeURIComponent(q), { signal:state.controller.signal });
          const data = await r.json();
          const rows = data && Array.isArray(data.results) ? data.results : [];
          if (!rows.length) {
            box.hidden = true;
            box.innerHTML = "";
            return;
          }
          box.innerHTML = rows.map((row,i) =>
            '<button type="button" class="address-suggestion" data-address-index="' + i + '">' +
              '<strong>' + escapeHtml(row.label) + '</strong>' +
              '<small>Victorian address</small>' +
            '</button>'
          ).join("");
          box.hidden = false;
          box.querySelectorAll("[data-address-index]").forEach(btn => {
            btn.addEventListener("mousedown", e => {
              e.preventDefault();
              const row = rows[Number(btn.dataset.addressIndex)];
              if (!row) return;
              input.value = row.address;
              input.dispatchEvent(new Event("input",{bubbles:true}));
              input.dispatchEvent(new Event("change",{bubbles:true}));
              box.hidden = true;
            });
          });
        } catch (err) {
          if (err && err.name === "AbortError") return;
          box.hidden = true;
        }
      },220);
    });

    input.addEventListener("blur", () => setTimeout(() => close(input),120));
    input.addEventListener("focus", () => {
      if (box.children.length) box.hidden = false;
    });
    return state;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#39;");
  }

  function init() {
    document.querySelectorAll('input[data-address-autocomplete], input[id*="address" i]').forEach(input => {
      if (input.type === "email") return;
      ensureBox(input);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",init);
  else init();
})();