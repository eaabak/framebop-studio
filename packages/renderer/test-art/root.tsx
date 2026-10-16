/** @jsxRuntime automatic @jsxImportSource react */
/** Remotion entry that draws each piece of test art, for `bake.mjs`. */
import { Composition, registerRoot } from "remotion";
import { PARTS } from "./parts";
import { PLATES } from "./plates";

const ART = { ...PARTS, ...PLATES };

interface PieceProps {
  name: string;
  /** Carried along so the bake script can record them. */
  pivot: { x: number; y: number } | null;
  tip: { x: number; y: number } | null;
}

function Piece(props: Record<string, unknown>) {
  const { name } = props as unknown as PieceProps;
  const piece = ART[name]!;
  return (
    <svg
      width={piece.width}
      height={piece.height}
      viewBox={`0 0 ${piece.width} ${piece.height}`}
    >
      {piece.draw()}
    </svg>
  );
}

function Root() {
  return (
    <>
      {Object.entries(ART).map(([name, piece]) => (
        <Composition
          key={name}
          id={name}
          component={Piece}
          defaultProps={{
            name,
            pivot: piece.pivot ?? null,
            tip: piece.tip ?? null,
          }}
          width={piece.width}
          height={piece.height}
          fps={30}
          durationInFrames={1}
        />
      ))}
    </>
  );
}

registerRoot(Root);
