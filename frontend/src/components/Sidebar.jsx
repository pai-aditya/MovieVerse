import { MoreVertical, ChevronLast, ChevronFirst } from "lucide-react"
import { createContext, useState } from "react"

export const SidebarContext = createContext();

const Sidebar = ({ children }) => {
  const [expanded, setExpanded] = useState(false)
  
  return (
    <aside className="h-screen sticky top-0">
      <nav className="h-full flex flex-col bg-custom-grey border-r shadow-sm">
        <div className="p-4 pb-2 flex justify-between items-center">
          <img
            src="../../icon.svg"
            className={`overflow-hidden transition-all ${
              expanded ? "w-12" : "w-0"
            }`}
            alt=""
          />
          <button
            onClick={() => setExpanded((curr) => !curr)}
            className="p-1.5 rounded-lg bg-white hover:bg-custom-purple"
          >
            {expanded ? <ChevronFirst /> : <ChevronLast />}
          </button>
        </div>

        <SidebarContext.Provider value={{ expanded }}>
          <ul className="flex-1 px-3">{children}</ul>
        </SidebarContext.Provider>

        <div className="border-t flex p-3">
          <img
            src="https://ui-avatars.com/api/?background=c7d2fe&color=3730a3&bold=true"
            alt=""
            className="w-10 h-10 rounded-md"
          />
          <div
            className={`
              flex justify-between items-center
              overflow-hidden transition-all ${expanded ? "w-52 ml-3" : "w-0"}
          `}
          >
            <div className="leading-4">
              <h4 className="font-semibold text-white">Aditya Pai</h4>
              <span className="text-xs text-white">sample@gmail.com</span>
            </div>
            <MoreVertical size={20} />
          </div>
        </div>
      </nav>
    </aside>
  )
};

export default Sidebar;