import Link from 'next/link';

const features = [
  ['01', 'Discover voices', 'Find conversations, shows, and ideas from creators around the world.'],
  ['02', 'Go live together', 'Bring hosts and listeners into one moderated audio or video room.'],
  ['03', 'Build your community', 'Follow creators and turn great conversations into lasting connections.'],
];

export default function HomePage() {
  return <main>
    <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><div className="navLinks"><Link href="/live">Explore LIVE</Link><Link href="/creator/setup">Become a creator</Link><Link href="/notifications">Notifications</Link><a href="#about">About</a></div><Link className="button small" href="/live">Enter VOXA <span>↗</span></Link></nav>
    <section className="hero">
      <div className="eyebrow"><span className="pulse" /> THE WORLD IS LISTENING</div>
      <h1>Every voice<br />has a <em>place.</em></h1>
      <p className="heroCopy">Listen to powerful conversations. Share what matters. Go live with a community that is ready to hear you.</p>
      <div className="heroActions"><Link className="button" href="/live">Explore VOXA LIVE <span>↗</span></Link><a className="textLink" href="#about">Discover the platform ↓</a></div>
      <div className="heroOrb orbOne" /><div className="heroOrb orbTwo" />
      <div className="heroNote"><b>VOXA LIVE</b><span>Real conversations. In real time.</span></div>
    </section>
    <section className="intro" id="about"><div><div className="eyebrow">A NEW KIND OF PLATFORM</div><h2>More than content.<br /><em>A place to belong.</em></h2></div><p>VOXA brings podcasts, creators, live rooms, and communities into one connected experience. Start by exploring live conversations while we build the wider creator platform.</p></section>
    <section className="featureGrid">{features.map(([n,t,d])=><article className="feature" key={n}><span>{n}</span><h3>{t}</h3><p>{d}</p></article>)}</section>
    <footer><Link className="brand" href="/">VOXA<span>.</span></Link><p>Listen. Speak. Connect.</p><small>© {new Date().getFullYear()} VOXA. Built for every voice.</small></footer>
  </main>;
}
