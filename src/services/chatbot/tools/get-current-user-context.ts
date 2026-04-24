import type { ChatModuleContext, UserChatProfile } from '@/types/chatbot';

export function getCurrentUserContext(
  profile: UserChatProfile,
  moduleContext?: ChatModuleContext
) {
  return {
    profileId: profile.profileId,
    displayName: profile.displayName,
    roleNames: profile.roleNames,
    departmentId: profile.departmentId,
    departmentName: profile.departmentName ?? null,
    moduleLabel: moduleContext?.moduleLabel ?? moduleContext?.pageLabel,
    pathname: moduleContext?.pathname ?? moduleContext?.route,
  };
}
