import { Trash } from "lucide-react";
import { getConfig } from "../config";
import { Chat } from "../models/chat";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/Sidebar";

type SidebarProps = {
  chats: Chat[];
  selectedChat: Chat | null;

  onSelectChat: (chat: Chat) => void;
  onDeleteChat: (chat: Chat) => void;
};

export function ChatSidebar({
  chats,
  selectedChat,
  onSelectChat,
  onDeleteChat,
}: SidebarProps) {
  const config = getConfig();

  return (
    <Sidebar>
      <SidebarHeader />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenuButton size="lg" asChild className="mb-4">
              <p className="text-xl font-semibold">
                {config.title ?? "Wingman"}
              </p>
            </SidebarMenuButton>
            <SidebarGroupLabel>Chats</SidebarGroupLabel>
            <SidebarMenu>
              {chats.map((chat) => (
                <SidebarMenuItem
                  key={chat.id}
                  onClick={() => onSelectChat(chat)}
                  className="flex items-center justify-between w-full overflow-hidden"
                >
                  <SidebarMenuButton isActive={chat.id === selectedChat?.id}>
                    <div className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                      {chat.title ?? "Untitled"}
                    </div>
                    <Trash
                      size={16}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteChat(chat);
                      }}
                    />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter />
    </Sidebar>
  );
}
