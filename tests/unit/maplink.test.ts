import { describe, expect, it } from 'vitest';
import { isMapLink, isShortMapLink, parseCoords, parseMapLink } from '../../shared/maplink';

// Places pasted into the map: coordinates and links from the map apps people use.

describe('coordinates', () => {
  it('reads decimal pairs and compass letters', () => {
    expect(parseCoords('48.8584, 2.2945')).toEqual({ lat: 48.8584, lon: 2.2945 });
    expect(parseCoords('-33.86,151.21')).toEqual({ lat: -33.86, lon: 151.21 });
    expect(parseCoords('40.7 N 74.0 W')).toEqual({ lat: 40.7, lon: -74 });
  });
  it('turns down text and impossible numbers', () => {
    expect(parseCoords('Paris')).toBeNull();
    expect(parseCoords('120, 20')).toBeNull();
  });
});

describe('map links', () => {
  it("reads a Google Maps place pin before the view's centre", () => {
    const p = parseMapLink('https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2922926,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d48.8583701!4d2.2944813');
    expect(p?.name).toBe('Eiffel Tower');
    expect(p?.lat).toBeCloseTo(48.8583701);
    expect(p?.lon).toBeCloseTo(2.2944813);
  });
  it('reads search links, OpenStreetMap and Apple Maps', () => {
    expect(parseMapLink('https://maps.google.com/?q=51.5007,-0.1246')).toMatchObject({ lat: 51.5007, lon: -0.1246 });
    expect(parseMapLink('https://www.openstreetmap.org/?mlat=35.6586&mlon=139.7454#map=17/35.6586/139.7454')).toMatchObject({ lat: 35.6586, lon: 139.7454 });
    expect(parseMapLink('https://maps.apple.com/?ll=37.8199,-122.4783&q=Golden%20Gate%20Bridge')).toMatchObject({ lat: 37.8199, lon: -122.4783 });
    expect(parseMapLink('https://www.google.com/maps/search/?api=1&query=Sydney+Opera+House')).toMatchObject({ name: 'Sydney Opera House' });
  });
  it('knows short share links and ignores other sites', () => {
    expect(isShortMapLink('https://maps.app.goo.gl/AbC123xyz')).toBe(true);
    expect(isMapLink('https://www.google.com/maps/place/Somewhere')).toBe(true);
    expect(isMapLink('https://www.google.com/search?q=hello')).toBe(false);
    expect(parseMapLink('https://example.com/?q=1,2')).toBeNull();
  });
});
