import { useEffect, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import '../banner.css';

// The event guidelines. The scoring lines assume a 20-second timer, 1,000 points, the bonuses and
// multipliers off and the round reset on, all set in the question bank and the host console.
const RULES = [
  { title: 'Speed matters', text: 'Faster correct answers earn more points, so answer as quickly as possible.' },
  { title: 'Scoring', text: 'Each question starts with a maximum of 1,000 points. 25 points are deducted for every second elapsed, making speed crucial.' },
  { title: 'Time limit', text: 'Every question has a 20-second countdown. Answers must be submitted before the timer expires.' },
  { title: 'Question display', text: 'Questions will appear on the big screen, while answers must be submitted through your phone.' },
  { title: 'One answer only', text: 'You can select only one answer per question. Once an option is selected, it is final and cannot be changed.' },
  { title: 'Automatic closure', text: 'Answer submissions will close automatically when the timer runs out. Unanswered questions receive zero points.' },
  { title: 'Round reset', text: 'Every participant starts each round with zero points.' },
  { title: 'Elimination', text: 'After each round, the bottom 40% of participants are eliminated. The top 60% advance to the next round.' },
  { title: 'Final round', text: 'There will be no elimination in the final round. The highest-scoring participant will be crowned the champion.' },
  { title: 'Tie-breaker', text: 'If participants finish with equal points, the participant with the lower total answer time will secure the higher rank.' },
  { title: 'Entry', text: 'Join using the Ticket ID printed on your pass. Only one phone is permitted per ticket.' },
  { title: 'Stay on screen', text: 'Participants must remain on the quiz screen throughout each question. Leaving the screen will be logged.' },
  { title: 'Fair play', text: 'All participants must play individually. The use of additional devices, outside assistance, or collaboration is strictly prohibited.' },
  { title: 'Disqualification', text: 'Any violation of the quiz rules may result in disqualification.' },
  { title: 'Final authority', text: "The coordinator's decision will be final and binding in all matters related to the quiz." },
];

// Fifteen guideline highlights at 3s each, plus time for the slide to arrive.
const SLIDES = [
  { Poster: EventPoster, seconds: 12 },
  { Poster: RulesPoster, seconds: 49 },
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
          <p className="poster-eyebrow">Tech Sprint · Vyuham '26</p>
          <h2>Guidelines</h2>
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
