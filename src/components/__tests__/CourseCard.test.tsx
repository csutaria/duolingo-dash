/**
 * @jest-environment node
 *
 * Renders CourseCard through React's server renderer and asserts the
 * window-XP / dim branches produce the right markup. We avoid a DOM test
 * environment on purpose: Jest runs node-only across this repo.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { CourseCard } from "../CourseCard";

jest.mock("next/link", () => {
  const Link = ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  );
  Link.displayName = "MockLink";
  return { __esModule: true, default: Link };
});

describe("CourseCard", () => {
  const baseProps = {
    courseId: "DUOLINGO_ES_EN",
    learningLanguage: "es",
    fromLanguage: "en",
    title: "Spanish",
    xp: 12345,
  };

  it("shows total XP headline by default", () => {
    const html = renderToStaticMarkup(<CourseCard {...baseProps} />);
    expect(html).toContain("12,345");
    expect(html).toContain("All-time XP");
    expect(html).not.toContain("+12,345");
    expect(html).not.toContain("XP total");
  });

  it("shows +windowXp headline with total as subtitle when windowXp is set", () => {
    const html = renderToStaticMarkup(<CourseCard {...baseProps} windowXp={420} />);
    expect(html).toContain("+420");
    expect(html).toContain("12,345 XP total");
  });

  it("shows em dash when windowXp is zero", () => {
    const html = renderToStaticMarkup(<CourseCard {...baseProps} windowXp={0} />);
    expect(html).toContain("\u2014");
    expect(html).toContain("12,345 XP total");
    expect(html).not.toContain("+0");
  });

  it("applies reduced-opacity class when dimmed", () => {
    const html = renderToStaticMarkup(<CourseCard {...baseProps} dimmed />);
    expect(html).toContain("opacity-60");
  });

  it("does not apply dim class when dimmed is omitted", () => {
    const html = renderToStaticMarkup(<CourseCard {...baseProps} />);
    expect(html).not.toContain("opacity-60");
  });
});
