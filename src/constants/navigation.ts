export const tabs = [
  { name: '(home)', title: 'Home', sf: 'house', md: 'home', icon: 'home' },
  { name: 'recipes', title: 'Recipes', sf: 'fork.knife', md: 'restaurant', icon: 'utensils' },
  { name: 'saved', title: 'Saved', sf: 'bookmark', md: 'bookmark_border', icon: 'bookmark' },
  { name: 'community', title: 'Community', sf: 'person.2', md: 'people_outline', icon: 'users' },
  {
    name: 'profile',
    title: 'Profile',
    sf: 'person.crop.circle',
    md: 'person_outline',
    icon: 'user',
  },
] as const;
