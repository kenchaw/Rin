import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";

export function NavBar({
  menu,
  onClick,
  itemClassName = "",
}: {
  menu: boolean;
  onClick?: () => void;
  itemClassName?: string;
}) {
  const [location] = useLocation();
  const { t } = useTranslation();

  return (
    <>
     <NavItem
  menu={menu}
  onClick={onClick}
  itemClassName={itemClassName}
  title="Articles"
  selected={location === "/" || location.startsWith("/feed")}
  href="/"
/>

<NavItem
  menu={menu}
  onClick={onClick}
  itemClassName={itemClassName}
  title="Headphones"
  selected={location === "/hashtag/Headphones"}
  href="/hashtag/Headphones"
/>

<NavItem
  menu={menu}
  onClick={onClick}
  itemClassName={itemClassName}
  title="Earbuds"
  selected={location === "/hashtag/Earbuds"}
  href="/hashtag/Earbuds"
/>

<NavItem
  menu={menu}
  onClick={onClick}
  itemClassName={itemClassName}
  title="Speakers"
  selected={location === "/hashtag/Speakers"}
  href="/hashtag/Speakers"
/>

<NavItem
  menu={menu}
  onClick={onClick}
  itemClassName={itemClassName}
  title="Chargers"
  selected={location === "/hashtag/Chargers"}
  href="/hashtag/Chargers"
/>

<NavItem
  menu={menu}
  onClick={onClick}
  itemClassName={itemClassName}
  title="QC Testing"
  selected={location === "/hashtag/QC-Testing"}
  href="/hashtag/QC-Testing"
/>

<NavItem
  menu={menu}
  onClick={onClick}
  itemClassName={itemClassName}
  title="About"
  selected={location === "/about"}
  href="/about"
/>
    </>
  );
}

function NavItem({
  menu,
  title,
  selected,
  href,
  when = true,
  onClick,
  itemClassName = "",
}: {
  title: string;
  selected: boolean;
  href: string;
  menu?: boolean;
  when?: boolean;
  onClick?: () => void;
  itemClassName?: string;
}) {
  return when ? (
    <Link
      href={href}
      className={`${menu ? "" : "hidden"} md:block cursor-pointer hover:text-theme duration-300 px-2 py-4 md:p-4 text-sm ${
        selected ? "text-theme" : "dark:text-white"
      } ${itemClassName}`}
      state={{ animate: true }}
      onClick={onClick}
    >
      {title}
    </Link>
  ) : null;
}
