import { Skeleton, SkeletonStatus } from "@/components/Skeleton";
import { Subtitle } from "@/components/Subtitle";

const trackWidths = [
  [14, 9],
  [9, 12],
  [18, 7],
  [11, 10],
  [16, 8],
] as const;

export const RecentTracksListSkeleton = () => (
  <SkeletonStatus>
    <ul className="recent-tracks placeholder" aria-hidden="true">
      {trackWidths.map(([name, artist], index) => (
        <li key={index}>
          <Skeleton width={name} /> &ndash; <Skeleton width={artist} />{" "}
          <Subtitle>
            <Skeleton width={12} />
          </Subtitle>
        </li>
      ))}
    </ul>
  </SkeletonStatus>
);
