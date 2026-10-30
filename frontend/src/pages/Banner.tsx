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

// Static version of the portal's <Rings />: the chakravyuha backdrop, not animated so exports match.
function Rings() {
  return (
    <svg className="poster-rings" viewBox="0 0 400 400" aria-hidden="true" fill="none">
      <circle cx="200" cy="200" r="196" stroke="currentColor" strokeWidth="1" strokeDasharray="2 10" opacity="0.5" />
      <circle cx="200" cy="200" r="150" stroke="currentColor" strokeWidth="1.2" strokeDasharray="700 242" opacity="0.35" />
      <circle cx="200" cy="200" r="172" stroke="currentColor" strokeWidth="0.8" opacity="0.18" />
      <circle cx="200" cy="200" r="112" stroke="currentColor" strokeWidth="1.2" strokeDasharray="520 184" opacity="0.4" />
      <circle cx="200" cy="200" r="74" stroke="currentColor" strokeWidth="0.8" strokeDasharray="1 6" opacity="0.6" />
      <circle cx="200" cy="200" r="40" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
      <circle cx="200" cy="200" r="4" fill="currentColor" stroke="none" opacity="0.8" />
    </svg>
  );
}

// Animated running man silhouette — CSS sprite-like animation with multiple poses
function RunningMan() {
  return (
    <div className="runner-container" aria-hidden="true">
      {/* Runner frame 1 — mid-stride */}
      <svg className="runner-frame runner-f1" viewBox="0 0 120 200" fill="currentColor">
        <circle cx="68" cy="18" r="14" />
        <path d="M55 35 L48 80 L30 120 L22 118 L38 82 L42 60 L35 95 L15 140 L25 142 L48 100 L55 75
                 L62 100 L55 140 L65 142 L75 105 L70 75 L78 100 L95 135 L105 130 L82 92 L75 60 L68 35Z" />
        <path d="M55 38 L30 55 L18 72 L26 76 L35 62 L55 50Z" opacity="0.9" />
        <path d="M55 38 L80 48 L100 42 L98 34 L80 40 L60 32Z" opacity="0.9" />
      </svg>
      {/* Runner frame 2 — extended stride */}
      <svg className="runner-frame runner-f2" viewBox="0 0 120 200" fill="currentColor">
        <circle cx="65" cy="16" r="14" />
        <path d="M52 32 L50 75 L60 110 L75 145 L85 140 L68 108 L58 78
                 L55 72 L40 108 L25 150 L35 152 L50 115 L58 85
                 L52 32Z" />
        <path d="M52 36 L25 45 L8 55 L12 62 L28 52 L52 45Z" opacity="0.9" />
        <path d="M52 36 L78 55 L95 65 L100 58 L82 48 L58 32Z" opacity="0.9" />
      </svg>
      {/* Runner frame 3 — pull phase */}
      <svg className="runner-frame runner-f3" viewBox="0 0 120 200" fill="currentColor">
        <circle cx="66" cy="17" r="14" />
        <path d="M54 34 L46 78 L35 115 L20 148 L30 152 L45 120 L52 85
                 L58 78 L68 110 L85 140 L95 135 L76 105 L64 75 L60 34Z" />
        <path d="M54 38 L35 60 L22 78 L30 82 L40 66 L54 48Z" opacity="0.9" />
        <path d="M54 38 L75 42 L92 35 L90 28 L75 34 L58 32Z" opacity="0.9" />
      </svg>
      {/* Runner frame 4 — contact phase */}
      <svg className="runner-frame runner-f4" viewBox="0 0 120 200" fill="currentColor">
        <circle cx="67" cy="17" r="14" />
        <path d="M55 33 L48 76 L42 105 L30 145 L40 148 L52 112 L56 82
                 L60 76 L72 105 L90 130 L98 125 L78 98 L66 72 L62 33Z" />
        <path d="M55 37 L40 52 L28 68 L36 72 L45 58 L55 45Z" opacity="0.9" />
        <path d="M55 37 L82 50 L100 55 L102 48 L84 42 L60 32Z" opacity="0.9" />
      </svg>
      {/* Speed lines */}
      <div className="runner-speed-lines">
        <span></span>
        <span></span>
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  );
}

function EventPoster() {
  return (
    <div className="poster poster-event">
      <Rings />

      <div className="poster-top">
        <Brand />
        <span className="poster-chip">Use code VYUHAMQZ50</span>
      </div>

      {/* Running man element */}
      <RunningMan />

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
