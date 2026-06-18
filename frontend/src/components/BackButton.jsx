import { useNavigate } from 'react-router-dom';
import { ChevronLeft} from 'lucide-react';
const BackButton = () => {

  let navigateTo = useNavigate();


  return (
    <div className='flex'>
      <button onClick={() => navigateTo(-1)} className='bg-blue-800 text-white px-4 py-1 rounded-lg w-fit'>
        <ChevronLeft  />
        </button>
    </div>
  );
};

export default BackButton;
