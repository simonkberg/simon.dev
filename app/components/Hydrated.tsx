"use client";

import { useEffect } from "react";

/** Marks `<html>` once React has hydrated, for the entry animations that wait on it. */
export const Hydrated = () => {
  useEffect(() => {
    document.documentElement.dataset["hydrated"] = "";
  }, []);
  return null;
};
