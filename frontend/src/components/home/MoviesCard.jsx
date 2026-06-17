// import { Link } from 'react-router-dom';
// import { PiBookOpenTextLight } from 'react-icons/pi';
// import { BiUserCircle } from 'react-icons/bi';
// import { AiOutlineEdit } from 'react-icons/ai';
// import { BsInfoCircle } from 'react-icons/bs';
// import { MdOutlineDelete } from 'react-icons/md';
import MovieSingleCard from './MovieSingleCard';

const MoviesCard = ({ movies }) => {
  return (
    <div className='grid xs:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'>
      {(movies || []).map((item) => (
        <MovieSingleCard key={item.id} movie={item} />
      ))}
    </div>
  );
};

export default MoviesCard;
