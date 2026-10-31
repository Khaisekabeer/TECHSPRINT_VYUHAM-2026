import { useEffect, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import '../banner.css';

// The event guidelines. The scoring lines assume 1,000 points, the bonuses and multipliers off and
// the round reset on; the cuts are set on each level in the question bank.
const RULES = [
  { title: 'Speed matters', text: 'Faster correct answers earn more points, so every second counts.' },
  { title: 'Scoring', text: 'Each question starts with a maximum of 1,000 points, with 25 points deducted for every second elapsed.' },
  { title: 'Time limit', text: 'Each question in the first round has a 20-second countdown.' },
  { title: 'Question display', text: 'Questions appear on the big screen, while answers must be submitted through your phone.' },
  { title: 'One answer only', text: 'You can select only one answer per question. Once an option is selected, it cannot be changed.' },
  { title: 'Automatic closure', text: 'Answer submissions close automatically when the timer expires. Incorrect or unanswered questions receive zero points.' },
  { title: 'Round reset', text: 'Every participant starts each round with zero points.' },
  { title: 'Round 1 to Round 2', text: 'The top 70% of participants advance to the second round. The remaining participants are eliminated.' },
  { title: 'Round 2 to Final', text: 'The top 60% of participants advance to the final round. The remaining participants are eliminated.' },
  { title: 'Final round', text: 'There will be no further elimination. The highest-scoring participant will be crowned the champion.' },
  { title: 'Tie-breaker', text: 'If participants have equal scores, the participant with the lower total answer time secures the higher rank.' },
  { title: 'Entry', text: 'Join using the Ticket ID printed on your pass. Only one phone is permitted per ticket.' },
  { title: 'Stay on screen', text: 'Participants must remain on the quiz screen throughout each question. Leaving the screen will be logged.' },
  { title: 'Fair play', text: 'All participants must play individually. The use of additional devices, outside assistance, or collaboration is strictly prohibited.' },
  { title: 'Disqualification', text: 'Any violation of the quiz rules may result in disqualification.' },
  { title: "Quizmaster's Authority", text: "The Quizmaster has the final authority in all matters related to the quiz, including scoring, tie-breakers, rule violations, disputes, and disqualification. The Quizmaster's decision shall be final and binding." },
];

// Sixteen guideline highlights at 3s each, plus time for the slide to arrive.
const SLIDES = [
  { Poster: EventPoster, seconds: 12 },
  { Poster: RulesPoster, seconds: 52 },
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

// The join page. A full page load, because the banner sits outside the socket provider.
function GameLink() {
  return <a className="poster-link" href={import.meta.env.BASE_URL}>Go to game →</a>;
}

function EventPoster({ live = false }: { live?: boolean }) {
  return (
    <div className={`poster poster-event${live ? ' live' : ''}`}>
      {live && <div className="poster-streaks" aria-hidden="true"><i /><i /><i /><i /><i /></div>}

      <div className="poster-top">
        <Brand />
        <GameLink />
      </div>

      <div className="poster-title poster-title-center">
        <p className="poster-eyebrow">Technology event</p>
        <h2><span>Tech</span><span>Sprint</span></h2>
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

function RulesPoster({ live = false }: { live?: boolean }) {
  return (
    <div className={`poster poster-rules${live ? ' live' : ''}`}>
      <div className="poster-head">
        <div>
          <p className="poster-eyebrow">Tech Sprint · Vyuham '26 · Oct 31, 2026 · 02 PM to 05 PM</p>
          <h2>Final Quiz Guidelines</h2>
          <p className="poster-lead">It's TechSprint. Speed matters. Every second counts!</p>
        </div>
        <div className="poster-head-side">
          <Brand />
          <GameLink />
        </div>
      </div>

      <ol className="poster-list">
        {RULES.map((rule, i) => (
          <li key={rule.title} style={{ '--i': i } as CSSProperties}>
            <span className="rule-no">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <h3>{rule.title}</h3>
              <p className="rule-text">{rule.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="poster-foot">
        <span className="poster-closing">All the best to all participants! Think fast, play smart, and may the sharpest mind win!</span>
        <div className="poster-prize-badge">
          <span className="poster-eyebrow">Prize pool</span>
          <b>₹10,000/-</b>
        </div>
        <span className="poster-url">vyuham.duk.ac.in</span>
      </div>
    </div>
  );
}

// Plays the posters in a loop. The progress bar is the timer, so Space pauses
// the slide and its timer together. Arrow keys need `keys`, the full-screen view.
function Slideshow({ keys = false }: { keys?: boolean }) {
  const [slide, setSlide] = useState(0);
  const [wipe, setWipe] = useState<'in' | 'out' | null>(null);
  const [paused, setPaused] = useState(false);
  const { Poster, seconds } = SLIDES[slide];

  const advance = () => setWipe(w => w ?? 'in');
  const wipeDone = () => {
    if (wipe === 'in') setSlide(s => (s + 1) % SLIDES.length);
    setWipe(wipe === 'in' ? 'out' : null);
  };

  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); setPaused(p => !p); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') advance();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys]);

  return (
    <div className={`slideshow${paused ? ' paused' : ''}`}>
      <Poster key={slide} live />
      <div className="slide-progress" aria-hidden="true">
        <i key={slide} style={{ '--slide-time': `${seconds}s` } as CSSProperties} onAnimationEnd={advance} />
      </div>
      {wipe && <div className={`slide-wipe ${wipe}`} aria-hidden="true" onAnimationEnd={wipeDone} />}
    </div>
  );
}

export default function Banner() {
  const [params] = useSearchParams();
  const view = params.get('view');

  // Full-screen views for exporting at 1920 × 1080
  if (view === 'event') return <div className="banner-solo"><EventPoster /></div>;
  if (view === 'rules') return <div className="banner-solo"><RulesPoster /></div>;
  if (view === 'slideshow') return <div className="banner-solo"><Slideshow keys /></div>;

  return (
    <main className="banner-page">
      <header className="banner-bar">
        <h1>TechSprint banners</h1>
        <nav>
          <a href="?view=slideshow">Slideshow full screen</a> · <a href="?view=event">Event full screen</a> · <a href="?view=rules">Guidelines full screen</a>
        </nav>
      </header>

      <div className="banner-list">
        <section aria-label="Slideshow">
          <p className="banner-cap">
            <span>Animated slideshow · 2 slides · loops</span>
            <a href="?view=slideshow">Open full screen</a>
          </p>
          <Slideshow />
        </section>

        <section aria-label="Event banner">
          <p className="banner-cap">
            <span>Event banner · 16:9 · 1920 × 1080</span>
            <a href="?view=event">Open full screen</a>
          </p>
          <EventPoster />
        </section>

        <section aria-label="Guidelines banner">
          <p className="banner-cap">
            <span>Guidelines banner · 16:9 · 1920 × 1080</span>
            <a href="?view=rules">Open full screen</a>
          </p>
          <RulesPoster />
        </section>
      </div>
    </main>
  );
}
