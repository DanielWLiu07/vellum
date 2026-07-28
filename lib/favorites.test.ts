import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetFavorites,
  deleteFavoritesFor,
  favoriteCount,
  favoriteCounts,
  isFavorite,
  listFavorites,
  setFavorite,
} from "./favorites";

beforeEach(() => __resetFavorites());

describe("setFavorite / isFavorite", () => {
  it("defaults to not-favorited", () => {
    expect(isFavorite("you", "u_1")).toBe(false);
  });

  it("saves and unsaves, returning the new state", () => {
    expect(setFavorite("you", "u_1", true)).toBe(true);
    expect(isFavorite("you", "u_1")).toBe(true);
    expect(setFavorite("you", "u_1", false)).toBe(false);
    expect(isFavorite("you", "u_1")).toBe(false);
  });

  it("is idempotent (saving twice keeps one entry)", () => {
    setFavorite("you", "u_1", true);
    setFavorite("you", "u_1", true);
    expect(listFavorites("you")).toEqual(["u_1"]);
  });
});

describe("listFavorites", () => {
  it("returns only that owner's saved ids", () => {
    setFavorite("you", "u_1", true);
    setFavorite("you", "u_2", true);
    setFavorite("nina", "u_3", true);
    expect(listFavorites("you").sort()).toEqual(["u_1", "u_2"]);
    expect(listFavorites("nina")).toEqual(["u_3"]);
    expect(listFavorites("ghost")).toEqual([]);
  });
});

describe("favoriteCount (future social like-count)", () => {
  it("counts how many distinct owners saved a resource", () => {
    setFavorite("you", "u_1", true);
    setFavorite("nina", "u_1", true);
    setFavorite("frank", "u_2", true);
    expect(favoriteCount("u_1")).toBe(2);
    expect(favoriteCount("u_2")).toBe(1);
    expect(favoriteCount("u_none")).toBe(0);
  });

  it("favoriteCounts returns the count for every saved resource at once", () => {
    setFavorite("you", "u_1", true);
    setFavorite("nina", "u_1", true);
    setFavorite("frank", "u_2", true);
    expect(favoriteCounts()).toEqual({ u_1: 2, u_2: 1 });
  });

  it("favoriteCounts is empty when nothing is saved", () => {
    expect(favoriteCounts()).toEqual({});
  });
});

describe("deleteFavoritesFor (orphan cleanup)", () => {
  it("removes the resource from every owner", () => {
    setFavorite("you", "u_1", true);
    setFavorite("nina", "u_1", true);
    setFavorite("you", "u_2", true);
    deleteFavoritesFor("u_1");
    expect(favoriteCount("u_1")).toBe(0);
    expect(isFavorite("you", "u_1")).toBe(false);
    expect(isFavorite("nina", "u_1")).toBe(false);
    expect(isFavorite("you", "u_2")).toBe(true); // unrelated favorite survives
  });

  it("leaves no empty owner buckets behind", () => {
    setFavorite("solo", "u_1", true);
    deleteFavoritesFor("u_1");
    expect(listFavorites("solo")).toEqual([]);
  });
});
