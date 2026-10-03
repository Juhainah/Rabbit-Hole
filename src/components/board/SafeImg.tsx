import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import { api } from '../../lib/api';

// Pictures from other sites fail now and then: Wikimedia turns away bursts of requests,
// some sites refuse to be shown elsewhere, links rot. A picture tries again a moment later,
// then comes through our own server, and only then gives way to a placeholder.

const proxied = new Map<string, string>();
const dead = new Set<string>();

/** Wikimedia serves a few standard thumbnail widths quickly; odd widths get turned away under load. */
function standardWidth(src: string) {
  return src.replace(/\/(\d+)px-([^/]+)$/, (m, w: string, rest: string) => {
    const n = Number(w);
    const std = [120, 250, 330, 500, 960, 1280].find((x) => x >= n) ?? 1280;
    return n === std ? m : `/${std}px-${rest}`;
  });
}

type Props = ImgHTMLAttributes<HTMLImageElement> & { src?: string; fallback?: ReactNode };

export function SafeImg({ src, fallback = null, onError, ...rest }: Props) {
  const first = src && /(upload|thumb)\.wikimedia\.org/.test(src) ? standardWidth(src) : src;
  const [current, setCurrent] = useState(() => (src && proxied.get(src)) ?? first);
  const [step, setStep] = useState(0);
  useEffect(() => {
    setCurrent((src && proxied.get(src)) ?? first);
    setStep(0);
  }, [src, first]);
  if (!src || dead.has(src)) return <>{fallback}</>;
  return (
    <img
      {...rest}
      src={current}
      referrerPolicy="no-referrer"
      onError={(e) => {
        onError?.(e);
        if (step === 0) {
          // A moment later, the same picture usually comes through.
          setStep(1);
          setTimeout(() => setCurrent(`${first}${first!.includes('?') ? '&' : '?'}r=1`), 1200 + Math.random() * 1500);
          return;
        }
        if (step === 1) {
          setStep(2);
          api
            .image(src)
            .then((blob) => {
              const url = URL.createObjectURL(blob);
              proxied.set(src, url);
              setCurrent(url);
            })
            .catch(() => {
              dead.add(src);
              setStep(3);
            });
          return;
        }
        dead.add(src);
        setStep(3);
      }}
    />
  );
}
