"use client";
// The front page hero: the headline, and a checkout floating over a globe.
// Choosing a country in the checkout turns the globe to it.
import { useState } from "react";
import { Globe } from "@/components/gpu/globe";
import { HeroDemo } from "./hero-demo";

export function HeroStage() {
  const [place, setPlace] = useState<string>("ng");
  return (
    <div className="hp-stage">
      <Globe focus={place === "anywhere" ? null : place} className="hp-globe" />
      <div className="hp-stage-card">
        <HeroDemo onPlace={setPlace} />
      </div>
    </div>
  );
}
