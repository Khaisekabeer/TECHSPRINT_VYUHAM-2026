import { Panel } from '../../components/ui';

export default function GameLinks() {
  return (
    <Panel>
      <div className="eyebrow">Live event</div>
      <h2 className="display" style={{ fontSize: '2.4rem', margin: '10px 0 8px' }}>Conduct the quiz</h2>
      <p className="dim" style={{ margin: '0 0 20px', maxWidth: 600, lineHeight: 1.5 }}>
        The quiz master loads the questions into the game first. Then open the host console to start the game and move
        through questions, and the projector screen on the laptop connected to the big screen.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <a className="btn btn-heat" href="/host" target="_blank" rel="noreferrer">Open host console ↗</a>
        <a className="btn btn-ghost" href="/screen" target="_blank" rel="noreferrer">Open projector screen ↗</a>
      </div>
    </Panel>
  );
}
