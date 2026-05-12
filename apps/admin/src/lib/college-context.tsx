'use client';

import { createContext, useContext } from 'react';

const CollegeSlugContext = createContext('');

export function CollegeSlugProvider({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}) {
  return (
    <CollegeSlugContext.Provider value={slug}>
      {children}
    </CollegeSlugContext.Provider>
  );
}

export const useCollegeSlug = () => useContext(CollegeSlugContext);
