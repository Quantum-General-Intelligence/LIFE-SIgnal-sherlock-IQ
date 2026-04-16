(() => {
  const form = document.getElementById("search-form");
  const usernameEl = document.getElementById("username");
  const sitesEl = document.getElementById("sites");
  const timeoutEl = document.getElementById("timeout");
  const nsfwEl = document.getElementById("include-nsfw");
  const onlyFoundEl = document.getElementById("only-found");
  const submitBtn = document.getElementById("submit-btn");
  const stopBtn = document.getElementById("stop-btn");

  const statusEl = document.getElementById("status");
  const bar = document.getElementById("progress-bar");
  const cDone = document.getElementById("count-done");
  const cTotal = document.getElementById("count-total");
  const cFound = document.getElementById("count-found");
  const cWaf = document.getElementById("count-waf");
  const cErr = document.getElementById("count-err");
  const siteCount = document.getElementById("site-count");

  const resultsEl = document.getElementById("results");
  const resultTarget = document.getElementById("results-target");
  const list = document.getElementById("result-list");
  const emptyEl = document.getElementById("empty");
  const chips = document.querySelectorAll(".chip");

  let es = null;
  let allRows = [];
  let filter = "found";

  fetch("/api/meta")
    .then((r) => r.json())
    .then((m) => {
      if (siteCount && m.site_count) {
        siteCount.textContent = `${m.site_count}+`;
      }
    })
    .catch(() => {});

  chips.forEach((c) =>
    c.addEventListener("click", () => {
      chips.forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
      filter = c.dataset.filter;
      render();
    })
  );

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (es) es.close();
    start();
  });

  stopBtn.addEventListener("click", () => {
    if (es) es.close();
    stop(true);
  });

  function start() {
    const username = usernameEl.value.trim();
    if (!username) return;

    allRows = [];
    list.innerHTML = "";
    emptyEl.hidden = true;

    resultTarget.textContent = "@" + username;
    resultsEl.hidden = false;
    statusEl.hidden = false;
    bar.style.width = "0%";
    cDone.textContent = "0";
    cFound.textContent = "0";
    cWaf.textContent = "0";
    cErr.textContent = "0";

    submitBtn.disabled = true;
    submitBtn.textContent = "Scanning…";
    stopBtn.hidden = false;

    const params = new URLSearchParams({
      username,
      timeout: timeoutEl.value || "30",
    });
    if (sitesEl.value.trim()) params.set("sites", sitesEl.value.trim());
    if (nsfwEl.checked) params.set("include_nsfw", "true");

    es = new EventSource(`/api/search/stream?${params.toString()}`);

    let total = 0;
    let done = 0;
    let found = 0;
    let waf = 0;
    let err = 0;

    es.addEventListener("meta", (ev) => {
      try {
        const data = JSON.parse(ev.data);
        total = data.total || 0;
        cTotal.textContent = total;
      } catch {}
    });

    es.addEventListener("result", (ev) => {
      try {
        const r = JSON.parse(ev.data);
        allRows.push(r);
        done += 1;
        if (r.status_key === "CLAIMED") found += 1;
        else if (r.status_key === "WAF") waf += 1;
        else if (r.status_key === "UNKNOWN" || r.status_key === "ILLEGAL") err += 1;

        cDone.textContent = done;
        cFound.textContent = found;
        cWaf.textContent = waf;
        cErr.textContent = err;
        if (total) bar.style.width = Math.min(100, (done / total) * 100) + "%";

        if (matchesFilter(r)) appendRow(r);
      } catch {}
    });

    es.addEventListener("error", (ev) => {
      try {
        if (ev.data) {
          const d = JSON.parse(ev.data);
          console.warn("stream error:", d.message || d);
        }
      } catch {}
    });

    es.addEventListener("done", () => {
      bar.style.width = "100%";
      stop(false);
    });

    es.onerror = () => {
      stop(true);
    };
  }

  function stop(aborted) {
    if (es) {
      es.close();
      es = null;
    }
    submitBtn.disabled = false;
    submitBtn.textContent = aborted ? "Scan" : "Scan again";
    stopBtn.hidden = true;
    if (!list.children.length) emptyEl.hidden = false;
  }

  function matchesFilter(r) {
    if (onlyFoundEl.checked && r.status_key !== "CLAIMED" && filter !== "all") {
      return filter === "waf"
        ? r.status_key === "WAF"
        : filter === "error"
        ? r.status_key === "UNKNOWN" || r.status_key === "ILLEGAL"
        : false;
    }
    switch (filter) {
      case "all":
        return true;
      case "found":
        return r.status_key === "CLAIMED";
      case "waf":
        return r.status_key === "WAF";
      case "error":
        return r.status_key === "UNKNOWN" || r.status_key === "ILLEGAL";
      default:
        return true;
    }
  }

  function render() {
    list.innerHTML = "";
    const filtered = allRows.filter(matchesFilter);
    for (const r of filtered) appendRow(r);
    emptyEl.hidden = filtered.length > 0;
  }

  function appendRow(r) {
    const klass = (r.status_key || "unknown").toLowerCase();
    const li = document.createElement("li");
    li.className = `result-item ${klass}`;
    const safeSite = escapeHtml(r.site);
    const url = r.url && r.status_key === "CLAIMED" ? r.url : null;
    li.innerHTML = `
      <span class="site" title="${safeSite}">${safeSite}</span>
      <span class="badge ${klass}">${escapeHtml(r.status)}</span>
      ${
        url
          ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(
              shortUrl(url)
            )}</a>`
          : ""
      }
    `;
    list.appendChild(li);
    emptyEl.hidden = true;
  }

  function shortUrl(u) {
    try {
      const x = new URL(u);
      return x.host + (x.pathname === "/" ? "" : x.pathname);
    } catch {
      return u;
    }
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }
})();
