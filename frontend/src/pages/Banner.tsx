import { useSearchParams } from 'react-router-dom';
import '../banner.css';

// Rules as the game enforces them (see README → Questions & scoring, Eliminations, Activity log).
const RULES = [
  { title: 'Check in and join', text: 'Check in at the entry with your pass. Join on your phone with the ticket ID on it. One phone per ticket.' },
  { title: 'Levels, one by one', text: 'Levels run in order. Every question has its own timer and is multiple choice or true / false.' },
  { title: 'One answer, on time', text: 'Tap once. Answers that arrive after the timer are not counted. A skipped question counts as its full timer.' },
  { title: 'How points work', text: 'Faster correct answers score more, from full points down to half at the last second. Bonuses for the first correct answer and for streaks.' },
  { title: 'The cut', text: 'After each level, players below the cut are out. The coordinator confirms every cut. The final level has no cut.' },
  { title: 'Ties', text: 'Higher score ranks first. On a tie, the player with less total answer time ranks higher.' },
  { title: 'Stay on the quiz screen', text: 'Leaving the quiz screen during a question is logged. Play alone: no second phone and no outside help.' },
  { title: 'Decisions are final', text: "Breaking a rule can mean disqualification: the live answer is discarded and there is no final rank. The coordinator's decision is final." },
];

// The portal's <Brand />: logo, name, and the festival tag.
function Brand() {
  return (
    <span className="poster-brand">
      <img src={`${import.meta.env.BASE_URL}vyuham-logo.png`} alt="" />
      TechSprint
      <span>Vyuham '26</span>
    </span>
  );
}

function EventPoster() {
  return (
    <div className="poster poster-event">

      <div className="poster-top">
        <Brand />
        <span className="poster-chip">Use code VYUHAMQZ50</span>
      </div>

      <div className="poster-title poster-title-center">
        <p className="poster-eyebrow">Technology event</p>
        <h2>Tech<br />Sprint</h2>
        <p className="poster-sub">Tech Quiz</p>
      </div>

      <div className="poster-foot">
        <div className="poster-date">
          <strong>Oct 31, 2026</strong>
          <span>02 PM to 05 PM</span>
        </div>
        <span className="poster-url">vyuham.duk.ac.in</span>
      </div>
    </div>
  );
}

function RulesPoster() {
  return (
    <div className="poster poster-rules">
      <div className="poster-head">
        <div>
          <p className="poster-eyebrow">Tech Sprint · Vyuham '26</p>
          <h2>Rules</h2>
          <p className="poster-lead">Read before you play</p>
        </div>
        <Brand />
      </div>

      <ol className="poster-list">
        {RULES.map((rule, i) => (
          <li key={rule.title}>
            <span className="rule-no">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <h3>{rule.title}</h3>
              <p className="rule-text">{rule.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="poster-foot">
        <span className="poster-eyebrow">Oct 31, 2026 · 02 PM to 05 PM</span>
        <div className="poster-prize-badge">
          <span className="poster-eyebrow">Prize pool</span>
          <b>₹10,000/-</b>
        </div>
        <span className="poster-url">vyuham.duk.ac.in</span>
      </div>
    </div>
  );
}

export default function Banner() {
  const [params] = useSearchParams();
  const view = params.get('view');

  // Full-screen views for exporting at 1920 × 1080
  if (view === 'event') return <div className="banner-solo"><EventPoster /></div>;
  if (view === 'rules') return <div className="banner-solo"><RulesPoster /></div>;

  return (
    <main className="banner-page">
      <header className="banner-bar">
        <h1>TechSprint banners</h1>
        <nav>
          <a href="?view=event">Event full screen</a> · <a href="?view=rules">Rules full screen</a>
        </nav>
      </header>

      <div className="banner-list">
        <section aria-label="Event banner">
          <p className="banner-cap">
            <span>Event banner · 16:9 · 1920 × 1080</span>
            <a href="?view=event">Open full screen</a>
          </p>
          <EventPoster />
        </section>

        <section aria-label="Rules banner">
          <p className="banner-cap">
            <span>Rules banner · 16:9 · 1920 × 1080</span>
            <a href="?view=rules">Open full screen</a>
          </p>
          <RulesPoster />
        </section>
      </div>
    </main>
  );
}
