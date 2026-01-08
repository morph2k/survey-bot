const surveyList = document.getElementById("survey-list");
const categoryRollup = document.getElementById("category-rollup");
const createForm = document.getElementById("survey-create");
const createMessage = document.getElementById("create-message");
const categoryForm = document.getElementById("category-create");
const categoryMessage = document.getElementById("category-message");
const categorySelect = document.getElementById("survey-category");
const filterForm = document.getElementById("filter-form");
const filterType = document.getElementById("filter-type");
const filterValue = document.getElementById("filter-value");
const filterWeekday = document.getElementById("filter-weekday");
const filterValueWrapper = document.getElementById("filter-value-wrapper");
const filterWeekdayWrapper = document.getElementById("filter-weekday-wrapper");

let activeFilter = { type: "all", value: "" };

function updateFilterInputs() {
  const type = filterType.value;
  filterValueWrapper.classList.add("hidden");
  filterWeekdayWrapper.classList.add("hidden");

  if (type === "after") {
    filterValueWrapper.classList.remove("hidden");
  } else if (type === "weekday") {
    filterWeekdayWrapper.classList.remove("hidden");
  }
}

async function fetchSurveys() {
  const res = await fetch("/api/surveys");
  if (res.status === 401) {
    window.location.href = "/admin";
    return;
  }

  const data = await res.json();
  surveyList.innerHTML = "";

  if (!data.surveys.length) {
    surveyList.innerHTML = "<p>No surveys yet. Create one above.</p>";
    return;
  }

  for (const survey of data.surveys) {
    const query = new URLSearchParams();
    query.set("filter", activeFilter.type);
    if (activeFilter.value) {
      query.set("value", activeFilter.value);
    }
    const stats = await fetch(`/api/surveys/${survey.id}/stats?${query}`).then((r) =>
      r.json()
    );

    const card = document.createElement("div");
    card.className = "stat";
    const categoryLabel = survey.category_name
      ? `<div class="tag">Category: ${survey.category_name}</div>`
      : "";
    const bucketList =
      stats.stats.buckets && stats.stats.buckets.length
        ? `<div class="stats">${stats.stats.buckets
            .map(
              (bucket) =>
                `<div>${bucket.label}: ${bucket.count} (avg ${bucket.average})</div>`
            )
            .join("")}</div>`
        : "";
    card.innerHTML = `
      <h3>${survey.name}</h3>
      <div class="tag">Slug: ${survey.slug}</div>
      ${categoryLabel}
      <div class="survey-actions">
        <a href="/s/${survey.slug}" target="_blank"><button type="button">Open survey</button></a>
        <a href="/api/surveys/${survey.id}/export?${query}"><button type="button" class="secondary">Export CSV</button></a>
      </div>
      <div class="stats">
        <div>
          <strong>Total</strong>
          <div>${stats.stats.total}</div>
        </div>
        <div>
          <strong>Average</strong>
          <div>${stats.stats.average}</div>
        </div>
        <div>
          <strong>Latest</strong>
          <div>${stats.stats.latest || "-"}</div>
        </div>
      </div>
      <div class="stats">
        <div>1: ${stats.stats.distribution[1]}</div>
        <div>2: ${stats.stats.distribution[2]}</div>
        <div>3: ${stats.stats.distribution[3]}</div>
        <div>4: ${stats.stats.distribution[4]}</div>
      </div>
      ${bucketList}
    `;
    surveyList.appendChild(card);
  }
}

async function fetchCategoryRollups() {
  const query = new URLSearchParams();
  query.set("filter", activeFilter.type);
  if (activeFilter.value) {
    query.set("value", activeFilter.value);
  }

  const res = await fetch(`/api/categories/rollup?${query}`);
  if (!res.ok) {
    return;
  }
  const data = await res.json();
  categoryRollup.innerHTML = "";

  if (!data.rollup.length) {
    categoryRollup.innerHTML = "<p>No category rollups yet.</p>";
    return;
  }

  for (const category of data.rollup) {
    const card = document.createElement("div");
    card.className = "stat";
    card.innerHTML = `
      <h3>${category.name}</h3>
      <div class="stats">
        <div>
          <strong>Total</strong>
          <div>${category.total}</div>
        </div>
        <div>
          <strong>Average</strong>
          <div>${category.average}</div>
        </div>
      </div>
      <div class="stats">
        <div>1: ${category.distribution[1]}</div>
        <div>2: ${category.distribution[2]}</div>
        <div>3: ${category.distribution[3]}</div>
        <div>4: ${category.distribution[4]}</div>
      </div>
    `;
    categoryRollup.appendChild(card);
  }
}

async function fetchCategories() {
  const res = await fetch("/api/categories");
  if (!res.ok) {
    return;
  }
  const data = await res.json();
  categorySelect.innerHTML = '<option value="">No category</option>';
  for (const category of data.categories) {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    categorySelect.appendChild(option);
  }
}

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(createForm);
  createMessage.classList.add("hidden");

  const res = await fetch("/api/surveys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: formData.get("name"),
      slug: formData.get("slug"),
      categoryId: formData.get("categoryId") || null
    })
  });

  if (!res.ok) {
    const data = await res.json();
    createMessage.textContent = data.error || "Unable to create survey";
    createMessage.classList.remove("hidden");
    return;
  }

  createMessage.textContent = "Survey created. Share the slug with participants.";
  createMessage.classList.remove("hidden");
  createForm.reset();
  fetchSurveys();
});

categoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(categoryForm);
  categoryMessage.classList.add("hidden");

  const res = await fetch("/api/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: formData.get("name")
    })
  });

  if (!res.ok) {
    const data = await res.json();
    categoryMessage.textContent = data.error || "Unable to create category";
    categoryMessage.classList.remove("hidden");
    return;
  }

  categoryMessage.textContent = "Category created.";
  categoryMessage.classList.remove("hidden");
  categoryForm.reset();
  fetchCategories();
});

filterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const type = filterType.value;
  let value = "";
  if (type === "after") {
    value = filterValue.value || "";
  } else if (type === "weekday") {
    value = filterWeekday.value || "";
  }
  activeFilter = { type, value };
  fetchSurveys();
  fetchCategoryRollups();
});

filterType.addEventListener("change", () => {
  updateFilterInputs();
});

updateFilterInputs();
fetchCategories();
fetchSurveys();
fetchCategoryRollups();
