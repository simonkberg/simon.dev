import type { PropsWithChildren } from "react";

export interface HeadingProps extends PropsWithChildren {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  id?: string;
}

export const Heading = ({ level, id, children }: HeadingProps) => {
  const Component = `h${level}` as const;

  return (
    <Component id={id} className="heading">
      {children}
    </Component>
  );
};
