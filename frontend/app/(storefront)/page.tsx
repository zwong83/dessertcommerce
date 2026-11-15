import Link from "next/link";
import { Icon } from "@/ui/icons";

export default function Storefront() {
  return (
    <main className="home-page">
      <section className="hero" aria-labelledby="welcome-title">
        <div className="hero-copy">
          <p className="eyebrow"><Icon name="spark" size={15} /> The dessert shop</p>
          <h1 id="welcome-title">Make it a little sweeter.</h1>
          <p>Desserts for the everyday and dessert tables for the days you’ll remember.</p>
          <div className="actions">
            <Link className="button" href="/shop">Explore desserts <Icon name="arrow" size={18} /></Link>
            <Link className="button button-secondary" href="/events/new">Plan a dessert table</Link>
          </div>
        </div>
        <figure className="hero-art">
          <img src="/gather-dessert-hero.webp" alt="Berry topped cake on a cream pedestal" width={1320} height={880} fetchPriority="high" />
          <figcaption>For the love of dessert</figcaption>
        </figure>
      </section>
      <section className="journeys" aria-labelledby="journeys-title">
        <div className="section-heading"><p className="eyebrow">Two ways to order</p><h2 id="journeys-title">What are you celebrating?</h2></div>
        <div className="journey-grid">
          <Link className="journey-card" href="/shop">
            <span className="tile-icon"><Icon name="cake" size={25} /></span>
            <div><h3>Something sweet</h3><p>Browse the dessert menu, build your cart, and choose pickup or delivery.</p></div>
            <Icon name="arrow" />
          </Link>
          <Link className="journey-card" href="/events/new">
            <span className="tile-icon"><Icon name="spark" size={25} /></span>
            <div><h3>A table worth gathering around</h3><p>Share your event details and receive a quote for your dessert table.</p></div>
            <Icon name="arrow" />
          </Link>
        </div>
      </section>
    </main>
  );
}
