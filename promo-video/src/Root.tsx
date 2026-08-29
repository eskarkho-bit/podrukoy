import React from 'react';
import { Composition } from 'remotion';
import { Reel, TOTAL_FRAMES } from './Reel';
import { Tsena, TSENA_FRAMES } from './Tsena';

export const Root: React.FC = () => (
  <>
    <Composition
      id="Bashnya"
      component={Reel}
      durationInFrames={TOTAL_FRAMES}
      fps={30}
      width={1080}
      height={1920}
    />
    <Composition
      id="Tsena"
      component={Tsena}
      durationInFrames={TSENA_FRAMES}
      fps={30}
      width={1080}
      height={1920}
    />
    {/* Версии с закадровым голосом — те же сцены, добавляется дорожка речи */}
    <Composition
      id="BashnyaVO"
      component={Reel}
      durationInFrames={TOTAL_FRAMES}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ vo: true }}
    />
    <Composition
      id="TsenaVO"
      component={Tsena}
      durationInFrames={TSENA_FRAMES}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ vo: true }}
    />
  </>
);
