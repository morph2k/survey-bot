const message = document.getElementById("survey-message");
const title = document.getElementById("survey-title");
const tag = document.getElementById("survey-tag");
const ratingGrid = document.getElementById("rating-grid");

const slug = window.location.pathname.split("/").pop();

async function loadSurvey() {
  const res = await fetch(`/api/surveys/slug/${encodeURIComponent(slug)}`);
  if (!res.ok) {
    title.textContent = "Survey not found";
    ratingGrid.classList.add("hidden");
    message.textContent = "Check the survey link or ask the issuer.";
    message.classList.remove("hidden");
    return;
  }

  const data = await res.json();
  title.textContent = data.survey.name;
  tag.textContent = `Survey: ${data.survey.slug}`;
}

async function submitRating(rating) {
  const res = await fetch(`/api/surveys/${encodeURIComponent(slug)}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating })
  });

  if (!res.ok) {
    message.textContent = "Something went wrong. Please try again.";
    message.classList.remove("hidden");
    return;
  }

  message.textContent = "Thanks! Your response has been recorded.";
  message.classList.remove("hidden");
}

ratingGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-rating]");
  if (!button) {
    return;
  }
  submitRating(Number(button.dataset.rating));
});

loadSurvey();
